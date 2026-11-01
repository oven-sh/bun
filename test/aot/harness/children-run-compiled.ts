// Preloaded into one of Bun's own test files: whatever the file starts runs compiled. `bun test` gets `--aot` (./children-under-aot.ts); `bun <file>` and `bun run <file>` get `--debug-aot`,
// which compiles the program and runs it where it lies; the text of `bun -e <text>` goes into a file in the child's working directory, and that file runs so; `bun build --compile` and
// `Bun.build({ compile })` get `--aot`. A letter in the file AOT_CHILDREN_STARTED counts each: r | e | b | B.
// The warnings of the build, which all bear a code (`warn: TS100064: ..`), go out of what the child writes to a pipe on stderr: a test that expects nothing there asks about the program.
// A warning that the program itself gives at run time bears none and stays.
import { appendFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import "./children-under-aot";

type Options = {
  cmd: string[];
  cwd?: unknown;
  timeout?: number;
  env?: Record<string, string | undefined>;
  stderr?: unknown;
};
const isFile = (word: string | undefined) => !!word && !word.startsWith("-") && /\.[cm]?[jt]sx?$/.test(word);

// These take no value, so a file or `-e` may stand behind them.
const flagsWithoutValue = new Set([
  "--smol",
  "--expose-gc",
  "--bun",
  "-b",
  "--silent",
  "--no-install",
  "--no-deprecation",
  "--throw-deprecation",
  "--no-addons",
  "--zero-fill-buffers",
  "--no-warnings",
]);
const written: string[] = [];
process.on("exit", () => written.forEach(file => rmSync(file, { force: true })));

/** `--debug-aot` refuses `-e`. The relative imports of the text resolve from the working directory, so the file lies there. */
function writeText(text: string, cwd: unknown): string {
  const folder = typeof cwd === "string" ? cwd : cwd instanceof URL ? Bun.fileURLToPath(cwd) : process.cwd();
  const file = join(folder, `eval-${process.pid}-${written.length}.js`);
  // With `-e` the arguments begin at process.argv[1]. On the first line of the text, so that its lines keep their numbers.
  writeFileSync(file, "process.argv.splice(1, 1);" + text);
  written.push(file);
  return file;
}

/** The command with its flag, or undefined where nothing of it can run compiled. */
function compiled(cmd: string[], cwd: unknown): [string[], string] | undefined {
  const bun = cmd.indexOf(process.execPath);
  if (bun < 0 || cmd.includes("--aot") || cmd.includes("--debug-aot")) return;
  let at = bun + 1;
  while (flagsWithoutValue.has(cmd[at])) at++;
  const [first, second] = [cmd[at], cmd[at + 1]];
  if ((first === "-e" || first === "--eval") && second?.trim())
    return [cmd.toSpliced(at, 2, writeText(second, cwd)).toSpliced(bun + 1, 0, "--debug-aot"), "e"];
  if (isFile(first)) return [cmd.toSpliced(bun + 1, 0, "--debug-aot"), "r"];
  if (at > bun + 1) return;
  if (first === "build") return cmd.includes("--compile") ? [cmd.toSpliced(bun + 2, 0, "--aot"), "b"] : undefined;
  if (first === "run" && isFile(second)) return [cmd.toSpliced(bun + 2, 0, "--debug-aot"), "r"];
}

/** Lines in, lines out: a warning goes with the lines of source above it and the place below it. */
function withoutWarnings() {
  let held: string[] = [];
  let isBehindWarning = false;
  return (line: string): string[] => {
    if (isBehindWarning && (/^\s+at /.test(line) || line === "")) {
      isBehindWarning = line !== "";
      return [];
    }
    isBehindWarning = false;
    if (/^\s*\d+ \| /.test(line) || /^\s*\^+\s*$/.test(line)) return (held.push(line), []);
    if (/^warn: TS\d+: /.test(line)) return ((held = []), (isBehindWarning = true), []);
    const out = [...held, line];
    held = [];
    return out;
  };
}

function filterText(text: string): string {
  const filter = withoutWarnings();
  const lines = text.split("\n");
  const last = lines.pop()!;
  const kept = lines.flatMap(filter);
  return [...kept, ...filter(last)].join("\n");
}

function filterStream(stream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const filter = withoutWarnings();
  const [decoder, encoder] = [new TextDecoder(), new TextEncoder()];
  let rest = "";
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const lines = (rest + decoder.decode(chunk, { stream: true })).split("\n");
        rest = lines.pop()!;
        const kept = lines.flatMap(filter);
        if (kept.length) controller.enqueue(encoder.encode(kept.join("\n") + "\n"));
      },
      flush(controller) {
        const kept = filter(rest).join("\n");
        if (kept) controller.enqueue(encoder.encode(kept));
      },
    }),
  );
}

function runCompiled<Start extends (...args: any[]) => any>(start: Start): Start {
  return function (this: unknown, first: string[] | Options, second?: Omit<Options, "cmd">) {
    const options: Options = Array.isArray(first) ? { ...second, cmd: first } : { ...first };
    const found = compiled([...options.cmd], options.cwd);
    if (!found) return start.call(this, first, second);
    const [cmd, letter] = found;
    appendFileSync(process.env.AOT_CHILDREN_STARTED!, letter);
    // A program may loop or wait for ever behind an import that an executable refuses.
    const timeout = Math.max(options.timeout ?? 0, 60_000);
    const child = start.call(this, { ...options, cmd, timeout });
    const note = (exitCode: number | null, signalCode: string | null | undefined) => {
      if (process.env.AOT_CHILDREN_STOPPED && (signalCode || (exitCode ?? 0) >= 128))
        appendFileSync(
          process.env.AOT_CHILDREN_STOPPED,
          `${cmd.slice(cmd.indexOf(process.execPath) + 1).join(" ")}: ${signalCode ?? `exit code ${exitCode}`}\n`,
        );
    };
    if (!(child.exited instanceof Promise)) {
      note(child.exitCode, child.signalCode);
      if (Buffer.isBuffer(child.stderr)) child.stderr = Buffer.from(filterText(child.stderr.toString()));
      return child;
    }
    child.exited.then((exitCode: number) => note(exitCode, child.signalCode));
    if (!(child.stderr instanceof ReadableStream)) return child;
    const stderr = filterStream(child.stderr);
    return new Proxy(child, {
      get(target, key) {
        if (key === "stderr") return stderr;
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  } as Start;
}

Bun.spawn = runCompiled(Bun.spawn);
Bun.spawnSync = runCompiled(Bun.spawnSync);

const build = Bun.build;
Bun.build = function (this: unknown, options: any, ...rest: unknown[]) {
  const compile = options?.compile;
  if (!compile || (typeof compile === "object" && "aot" in compile)) return build.call(this, options, ...rest);
  appendFileSync(process.env.AOT_CHILDREN_STARTED!, "B");
  const asObject = typeof compile === "object" ? compile : typeof compile === "string" ? { target: compile } : {};
  return build.call(this, { ...options, compile: { ...asObject, aot: true } }, ...rest);
} as typeof Bun.build;
