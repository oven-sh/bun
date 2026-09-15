import { createWriteStream } from "node:fs";
import { resolve, sep } from "node:path";
import { PassThrough } from "node:stream";
import { run } from "node:test";
import reporters from "node:test/reporters";
import { debuglog } from "node:util";

const debug = debuglog("test_runner");

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

function isTestRunnerFlag(name: string) {
  return name === "--test" || name.startsWith("--test-") || name.startsWith("--experimental-test-");
}

// Splits process.execArgv into the runner's own flags and everything else.
// Like node's filterExecArgv (runner.js), the remainder is forwarded to each
// test child so runtime flags (--conditions, preloads, ...) apply there; the
// runner's flags and the watchers that would keep a child alive are not.
function parseExecArgv() {
  const single = new Map<string, string>();
  const multi = new Map<string, string[]>();
  const bools = new Set<string>();
  const passthrough: string[] = [];
  const argv = process.execArgv;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (!isTestRunnerFlag(name)) {
      if (name !== "--watch" && name !== "--hot") passthrough.push(arg);
      continue;
    }
    let value: string | undefined;
    if (eq !== -1) {
      value = arg.slice(eq + 1);
    } else if (!kBooleanFlags.has(name) && i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      value = argv[++i];
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
  return { single, multi, bools, passthrough };
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

// File discovery — node's createTestFileList / kDefaultPattern:
// https://github.com/nodejs/node/blob/main/lib/internal/test_runner/runner.js
// Split into two globs: Bun.Glob mis-parses `test/**/*` nested in a brace group.
const kDefaultPatterns = ["**/{test,test-*,*[._-]test}.{js,mjs,cjs}", "**/test/**/*.{js,mjs,cjs}"];
const kGlobMagic = /[*?[\]{}!]/;
function hasNoGlobMagic(pattern) {
  return !kGlobMagic.test(pattern);
}

function createTestFileList(patterns: string[], cwd: string): string[] {
  const { existsSync } = require("node:fs");
  const usingDefault = patterns.length === 0;
  if (usingDefault) patterns = kDefaultPatterns;

  const results = new Set<string>();
  for (const pattern of patterns) {
    if (!kGlobMagic.test(pattern)) {
      // node takes an existing literal as-is (a directory then fails as a test
      // file; observed on v26.3.0) and drops a missing one. Same rule as
      // discoverRunFiles in node/test.ts.
      const absolute = resolve(cwd, pattern);
      if (existsSync(absolute)) results.add(absolute);
      continue;
    }
    for (const match of new Bun.Glob(pattern).scanSync({ cwd, onlyFiles: true })) {
      if (hasNodeModulesSegment(match)) continue;
      results.add(resolve(cwd, match));
    }
  }

  if (!usingDefault && results.size === 0 && patterns.every(hasNoGlobMagic)) {
    console.error(`Could not find '${patterns.join(", ")}'`);
    process.exit(1);
  }

  return Array.from(results).sort();
}

function hasNodeModulesSegment(match: string) {
  return match.split(sep).includes("node_modules") || match.split("/").includes("node_modules");
}

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
    const specifier = name.startsWith(".") ? resolve(process.cwd(), name) : name;
    let mod;
    try {
      mod = await import(specifier);
    } catch (err) {
      if ((err as { name?: string })?.name === "ResolveMessage") {
        const error = new Error((err as Error)?.message ?? String(err));
        (error as { code?: string }).code = (err as { code?: string })?.code ?? "ERR_MODULE_NOT_FOUND";
        throw error;
      }
      throw err;
    }
    reporter = mod.default ?? mod;
  }
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

function attachReporter(reporter, source, destination): Promise<void> {
  const { compose } = require("node:stream");
  const endDestination = destination !== process.stdout && destination !== process.stderr;
  function reporterExecutor(resolvePromise, rejectPromise) {
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
  }
  return new Promise(reporterExecutor);
}

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
    function isThisShard(_, i: number) {
      return i % total === index - 1;
    }
    files = files.filter(isThisShard);
  }

  const runOptions: Record<string, unknown> = { __proto__: null, files, cwd, execArgv: flags.passthrough };

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

  // --test-only is rejected below before run() sees it; forceExit is validated
  // by run() and acted on at the end of main().
  const forceExit = hasFlag("--test-force-exit");
  runOptions.forceExit = forceExit;

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
  if (tagFilters.length > 0) {
    // run() applies tag filters only under isolation 'none' (the child runner
    // has no tag filter yet); fail loudly like the sibling filter flags rather
    // than run every test.
    if (isolation !== "none") {
      fatal(new Error("--experimental-test-tag-filter requires --test-isolation=none in Bun's node:test CLI mode"));
    }
    runOptions.testTagFilters = tagFilters;
  }

  if (hasFlag("--experimental-test-coverage")) runOptions.coverage = true;
  if (hasFlag("--test-randomize") || getFlag("--test-random-seed") !== undefined) {
    fatal(new Error("--test-randomize is not yet implemented in Bun's node:test CLI mode"));
  }
  const globalSetup = getFlag("--test-global-setup");
  if (globalSetup !== undefined) runOptions.globalSetupPath = resolve(cwd, globalSetup);
  if (isolation !== undefined) runOptions.isolation = isolation;

  debug("run options: %o", runOptions);

  let resolved: unknown[];
  try {
    resolved = await Promise.all(reporterNames.map(resolveReporter));
  } catch (err) {
    console.error(require("node:util").inspect(err));
    process.exit(7);
  }

  const abortController = new AbortController();
  runOptions.signal = abortController.signal;

  // node's harness installs process signal handlers only under --test
  // https://github.com/nodejs/node/blob/main/lib/internal/test_runner/harness.js
  function onRunnerSignal() {
    abortController.abort();
    if (runOptions.isolation === "none") {
      process.exit(1);
    }
  }
  process.on("SIGINT", onRunnerSignal);
  process.on("SIGTERM", onRunnerSignal);

  let stream;
  try {
    stream = run(runOptions);
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
    return;
  }

  let success = true;
  function onTestSummary(data) {
    if (data.file === undefined) success = data.success;
  }
  stream.on("test:summary", onTestSummary);

  const reporterPromises: Promise<void>[] = [];
  for (let i = 0; i < resolved.length; i++) {
    const destination = destinationFor(destinationNames[i]);
    const copy = new PassThrough({ objectMode: true });
    stream.pipe(copy);
    reporterPromises.push(attachReporter(resolved[i], copy, destination));
  }

  try {
    await Promise.all(reporterPromises);
  } catch (err) {
    // A reporter that errors mid-stream: node's unfinished-TLA exit code.
    abortController.abort();
    console.error((err as Error)?.stack ?? err);
    process.exit(7);
  } finally {
    process.off("SIGINT", onRunnerSignal);
    process.off("SIGTERM", onRunnerSignal);
  }

  if (!success) process.exitCode = 1;
  if (forceExit) {
    process.exit(process.exitCode ?? 0);
  }
}

await main();
