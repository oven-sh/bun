// `bun --test` — Node.js test-runner CLI mode, booted through the eval path
// (cli/Arguments.rs). Positionals arrive in process.argv as glob patterns; the
// `--test-*` flags are read from process.execArgv like node's runner main.
import { createWriteStream } from "node:fs";
import { resolve, sep } from "node:path";
import { PassThrough } from "node:stream";
import { run } from "node:test";
import reporters from "node:test/reporters";
import { debuglog } from "node:util";

const debug = debuglog("test_runner");

// ---------------------------------------------------------------------------
// Flag parsing (node's own parser already validated shape; this reads values).
// ---------------------------------------------------------------------------
const kBooleanFlags = new Set([
  "--test",
  "--test-only",
  "--test-force-exit",
  "--test-randomize",
  "--test-update-snapshots",
  "--experimental-test-coverage",
  "--experimental-test-module-mocks",
  "--experimental-test-snapshots",
]);

function parseExecArgv() {
  const single = new Map<string, string>();
  const multi = new Map<string, string[]>();
  const bools = new Set<string>();
  const argv = process.execArgv;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    let name: string;
    let value: string | undefined;
    if (eq !== -1) {
      name = arg.slice(0, eq);
      value = arg.slice(eq + 1);
    } else {
      name = arg;
      if (!kBooleanFlags.has(name) && i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        value = argv[++i];
      }
    }
    if (value === undefined) {
      bools.add(name);
    } else {
      single.set(name, value);
      let list = multi.get(name);
      if (list === undefined) {
        list = [];
        multi.set(name, list);
      }
      list.push(value);
    }
  }
  return { single, multi, bools };
}

const flags = parseExecArgv();

function getFlag(name: string) {
  return flags.single.get(name);
}

function getFlagList(name: string) {
  return flags.multi.get(name) ?? [];
}

function hasFlag(name: string) {
  return flags.bools.has(name) || flags.single.has(name);
}

function fatal(err: unknown): never {
  console.error(err);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// File discovery — node's createTestFileList (runner.js:153-170).
// ---------------------------------------------------------------------------
// node's default (utils.js:71-77) — ts/mts/cts only join behind --strip-types
// there, so matching its default keeps discovery byte-compatible. Split into
// two globs: Bun.Glob mis-parses `test/**/*` nested inside a brace group.
const kDefaultPatterns = ["**/{test,test-*,*[._-]test}.{js,mjs,cjs}", "**/test/**/*.{js,mjs,cjs}"];
const kGlobMagic = /[*?[\]{}!]/;

function createTestFileList(patterns: string[], cwd: string): string[] {
  const { statSync } = require("node:fs");
  const usingDefault = patterns.length === 0;
  if (usingDefault) patterns = kDefaultPatterns;

  const results = new Set<string>();
  for (const pattern of patterns) {
    if (!kGlobMagic.test(pattern)) {
      // A literal path: a file is taken as-is, a directory is searched with
      // the default pattern (node's Glob resolves literals the same way).
      const absolute = resolve(cwd, pattern);
      let stat;
      try {
        stat = statSync(absolute);
      } catch {
        continue;
      }
      if (stat.isFile()) {
        results.add(absolute);
      } else if (stat.isDirectory()) {
        for (const defaultPattern of kDefaultPatterns) {
          for (const match of new Bun.Glob(defaultPattern).scanSync({ cwd: absolute, onlyFiles: true })) {
            if (hasNodeModulesSegment(match)) continue;
            results.add(resolve(absolute, match));
          }
        }
      }
      continue;
    }
    for (const match of new Bun.Glob(pattern).scanSync({ cwd, onlyFiles: true })) {
      // node's Glob excludes any path containing a node_modules segment.
      if (hasNodeModulesSegment(match)) continue;
      results.add(resolve(cwd, match));
    }
  }

  if (!usingDefault && results.size === 0 && patterns.every(pattern => !kGlobMagic.test(pattern))) {
    console.error(`Could not find '${patterns.join(", ")}'`);
    process.exit(1);
  }

  return Array.from(results).sort();
}

function hasNodeModulesSegment(match: string) {
  return match.split(sep).includes("node_modules") || match.split("/").includes("node_modules");
}

// ---------------------------------------------------------------------------
// Reporter setup — node's parseCommandLine + setup (internal/test_runner/utils.js).
// ---------------------------------------------------------------------------
const kBuiltinReporters = {
  __proto__: null,
  dot: reporters.dot,
  junit: reporters.junit,
  spec: reporters.spec,
  tap: reporters.tap,
  lcov: reporters.lcov,
};

async function resolveReporter(name: string) {
  let reporter: unknown = kBuiltinReporters[name];
  if (reporter === undefined) {
    // Custom reporter: a module specifier, resolved like node resolves it.
    const specifier = name.startsWith(".") ? resolve(process.cwd(), name) : name;
    let mod;
    try {
      mod = await import(specifier);
    } catch (err) {
      // Rewrap: bun's ResolveMessage hides `code` from inspection, and the
      // reporter tests look for ERR_MODULE_NOT_FOUND in stderr like node's.
      const error = new Error((err as Error)?.message ?? String(err));
      (error as { code?: string }).code = (err as { code?: string })?.code ?? "ERR_MODULE_NOT_FOUND";
      throw error;
    }
    reporter = mod.default ?? mod;
  }
  // node news any constructor-carrying function (utils.js getReportersMap).
  // The own-constructor identity check keeps bundled async generators (whose
  // shared prototype carries an AsyncGeneratorFunction constructor) as-is.
  if (
    (reporter as { prototype?: object })?.prototype &&
    Object.getOwnPropertyDescriptor((reporter as { prototype: object }).prototype, "constructor")?.value === reporter
  ) {
    reporter = new (reporter as new () => unknown)();
  }
  if (typeof reporter !== "function" && !(reporter && typeof (reporter as any).pipe === "function")) {
    const error = new TypeError(
      `The "Reporter" argument must be a function or a stream. Received ${reporter === undefined ? "undefined" : typeof reporter}`,
    );
    (error as { code?: string }).code = "ERR_INVALID_ARG_TYPE";
    throw error;
  }
  return reporter;
}

function destinationFor(dest: string) {
  if (dest === "stdout") return process.stdout;
  if (dest === "stderr") return process.stderr;
  return createWriteStream(resolve(process.cwd(), dest));
}

// Wires one reporter over its own copy of the event stream, node-style:
// compose(source, reporter).pipe(destination) (internal/test_runner/utils.js).
// Returns a promise that settles when the reporter has flushed everything.
function attachReporter(reporter, source, destination): Promise<void> {
  const { compose } = require("node:stream");
  const endDestination = destination !== process.stdout && destination !== process.stderr;
  return new Promise((resolvePromise, rejectPromise) => {
    const composed = compose(source, reporter);
    composed.on("error", rejectPromise);
    const out = composed.pipe(destination, { end: endDestination });
    out.on("error", rejectPromise);
    if (endDestination) {
      destination.on("finish", resolvePromise);
      destination.on("error", rejectPromise);
    } else {
      composed.on("end", resolvePromise);
    }
  });
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------
async function main() {
  const cwd = process.cwd();
  const patterns = process.argv.slice(1);

  const reporterNames = getFlagList("--test-reporter");
  const destinationNames = getFlagList("--test-reporter-destination");
  if (reporterNames.length === 0 && destinationNames.length === 0) {
    reporterNames.push("spec");
    destinationNames.push("stdout");
  } else if (reporterNames.length === 1 && destinationNames.length === 0) {
    destinationNames.push("stdout");
  } else if (reporterNames.length !== destinationNames.length) {
    const { inspect } = require("node:util");
    const error = new TypeError(
      `The argument '--test-reporter' must match the number of specified '--test-reporter-destination'. ` +
        `Received ${inspect(reporterNames)}`,
    );
    (error as { code?: string }).code = "ERR_INVALID_ARG_VALUE";
    fatal(error);
  }

  let files = createTestFileList(patterns, cwd);

  const shard = getFlag("--test-shard");
  if (shard !== undefined) {
    const match = /^(\d+)\/(\d+)$/.exec(shard);
    if (match === null) {
      const error = new TypeError(
        `The argument '--test-shard' must be in the form of <index>/<total>. Received '${shard}'`,
      );
      (error as { code?: string }).code = "ERR_INVALID_ARG_VALUE";
      fatal(error);
    }
    const index = Number(match[1]);
    const total = Number(match[2]);
    if (index < 1 || index > total) {
      const error = new RangeError(
        `The value of "index" is out of range. It must be >= 1 && <= ${total}. Received ${index}`,
      );
      (error as { code?: string }).code = "ERR_OUT_OF_RANGE";
      fatal(error);
    }
    files = files.filter((_, i) => i % total === index - 1);
  }

  const runOptions: Record<string, unknown> = { __proto__: null, files, cwd };

  // node: concurrency defaults to true under process isolation, and
  // isolation:'none' forces 1 regardless of --test-concurrency (runner.js).
  const isolation = getFlag("--test-isolation") ?? getFlag("--experimental-test-isolation");
  const concurrencyFlag = getFlag("--test-concurrency");
  if (isolation === "none") {
    runOptions.concurrency = 1;
  } else if (concurrencyFlag !== undefined) {
    runOptions.concurrency = Number(concurrencyFlag);
  } else {
    runOptions.concurrency = true;
  }

  const timeout = getFlag("--test-timeout");
  runOptions.timeout = timeout !== undefined ? Number(timeout) : Infinity;

  // Always present so the debuglog line keys carry a trailing comma, which
  // node's own tests match on (`/timeout: Infinity,/`).
  runOptions.only = hasFlag("--test-only");
  runOptions.forceExit = hasFlag("--test-force-exit");

  // run() validates these but does not yet apply them to its child processes;
  // failing loudly beats silently running every test.
  if (getFlagList("--test-name-pattern").length > 0) {
    fatal(new Error("--test-name-pattern is not yet implemented in Bun's node:test CLI mode"));
  }
  if (getFlagList("--test-skip-pattern").length > 0) {
    fatal(new Error("--test-skip-pattern is not yet implemented in Bun's node:test CLI mode"));
  }
  if (hasFlag("--test-only")) {
    fatal(new Error("--test-only is not yet implemented in Bun's node:test CLI mode"));
  }
  const tagFilters = getFlagList("--experimental-test-tag-filter");
  if (tagFilters.length > 0) runOptions.testTagFilters = tagFilters;

  // Options this mode cannot honor yet fail loudly instead of silently
  // dropping the behavior the caller asked for (same policy as run()).
  if (hasFlag("--experimental-test-coverage")) runOptions.coverage = true;
  if (hasFlag("--test-randomize") || getFlag("--test-random-seed") !== undefined) {
    fatal(new Error("--test-randomize is not yet implemented in Bun's node:test CLI mode"));
  }
  const globalSetup = getFlag("--test-global-setup");
  if (globalSetup !== undefined) runOptions.globalSetupPath = resolve(cwd, globalSetup);
  if (isolation !== undefined) runOptions.isolation = isolation;

  debug("run options: %o", runOptions);

  let stream;
  try {
    stream = run(runOptions);
  } catch (err) {
    // Soft exit: a pending process.emitWarning (e.g. the experimental tags
    // warning from option validation) still flushes on the next tick.
    console.error(err);
    process.exitCode = 1;
    return;
  }

  let success = true;
  stream.on("test:summary", data => {
    if (data.file === undefined) success = data.success;
  });

  const reporterPromises: Promise<void>[] = [];
  for (let i = 0; i < reporterNames.length; i++) {
    let reporter;
    try {
      reporter = await resolveReporter(reporterNames[i]);
    } catch (err) {
      // node's main is ESM: a reporter that can't be set up leaves the
      // top-level await unfinished, which exits with code 7. inspect() keeps
      // the error's `code` visible, like node's fatal printer.
      console.error(require("node:util").inspect(err));
      process.exit(7);
    }
    const destination = destinationFor(destinationNames[i]);
    // Each reporter gets its own copy of the stream: a Readable broadcasts to
    // every piped destination, and object-mode PassThroughs keep the
    // per-reporter iteration independent.
    const copy = new PassThrough({ objectMode: true });
    stream.pipe(copy);
    reporterPromises.push(attachReporter(reporter, copy, destination));
  }

  try {
    await Promise.all(reporterPromises);
  } catch (err) {
    // A reporter that errors mid-stream: node's unfinished-TLA exit code.
    console.error((err as Error)?.stack ?? err);
    process.exit(7);
  }

  const exitCode = success ? 0 : 1;
  if (hasFlag("--test-force-exit")) {
    process.exit(exitCode);
  }
  process.exitCode = exitCode;
}

await main();
