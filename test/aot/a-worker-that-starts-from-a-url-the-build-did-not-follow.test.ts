// `new Worker(new URL("./job.mjs", import.meta.url))` is how a program names the file of a Worker for the build. Where the load cannot read a file off the URL, or
// reads a name and finds nothing there, the executable has no such file and the Worker fails to load. The engine names such a start only by its URL, which nothing read:
// the build said nothing. It says TS100082 at the start, as it does for a path and for the Worker of node:worker_threads.
import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { basename, join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const answers = `worker.onmessage = event => { console.log("worker says " + event.data); worker.terminate(); };
worker.onerror = event => { console.log("worker error: " + event.message); };
`;
const never = "process.argv.length > 90";

// Each file is an entry point of one build, and a start stands in line 2. Only main.mjs runs.
const files: Record<string, string> = {
  "main.mjs": `console.log(typeof import.meta);
const worker = new Worker(new URL("./lost.mjs", import.meta.url));
${answers}`,
  "base.mjs": `const base = process.env.BASE_OF_JOBS ?? import.meta.url;
const worker = new Worker(new URL("./job.mjs", base));
${answers}`,
  "text.mjs": `const text = process.argv[91];
if (${never}) new Worker(new URL(text, import.meta.url));
`,
  "name.mjs": `const url = new URL("./job.mjs", process.argv[91]);
if (${never}) new Worker(url);
`,
  "href.mjs": `const url = new URL("./job.mjs", process.argv[91]);
if (${never}) new Worker(url.href);
`,
  "absent.mjs": `const said = "nothing lies there";
if (${never}) new Worker(new URL("./no-such-file.mjs", import.meta.url));
console.log(said);
`,
  "followed.mjs": `export const address = request => new URL(request.url, "http://localhost");
if (${never}) new Worker(new URL("./job.mjs", import.meta.url));
`,
  "listed.mjs": `const said = "the file is an entry point";
if (${never}) new Worker(new URL("./entry.mjs", import.meta.url));
console.log(said);
`,
  "unreached.mjs": `function start() { const url = new URL("./job.mjs", process.argv[91] ?? import.meta.url);
return new Worker(url); }
console.log("nothing calls it");
`,
  "global.mjs": `const name = process.argv[91] ?? "first";
if (${never}) new globalThis.Worker(import.meta.dir + "/jobs/" + name + ".mjs");
`,
  "entry.mjs": `postMessage("entry");\n`,
  "job.mjs": `postMessage("job");\n`,
  "lost.mjs": `postMessage("lost");\n`,
  "jobs/first.mjs": `postMessage("first");\n`,
};
const entryPoints = Object.keys(files).filter(name => !["job.mjs", "lost.mjs", "jobs/first.mjs"].includes(name));
const warnedOf = [
  "absent.mjs:2:35",
  "base.mjs:2:20",
  "href.mjs:2:35",
  "main.mjs:2:20",
  "name.mjs:2:35",
  "text.mjs:2:35",
];

// A build and `bun run --aot` print the place behind `at`, `bun check --aot` in front of the message.
const placesOf = (said: string) =>
  [
    ...said.matchAll(/^warn: TS100082: .*\n +at (.+:\d+:\d+)$/gm),
    ...said.matchAll(/^(.+)\((\d+),(\d+)\): warning TS100082: /gm),
  ]
    .map(([, file, line, column]) => basename(line ? `${file}:${line}:${column}` : file))
    .sort();

test("a build warns at each start whose URL it did not follow, and at no other", async () => {
  using dir = tempDir("aot-worker-url-not-followed", files);
  const cwd = String(dir);
  const executable = join(cwd, isWindows ? "program.exe" : "program");
  const build = [bunExe(), "build", "--compile", "--aot", "--aot-threads=1", ...entryPoints, "--outfile", executable];
  const built = await run(build, cwd);
  expect({ warnedOf: placesOf(built.stderr), exitCode: built.exitCode }).toEqual({ warnedOf, exitCode: 0 });
  const ran = await run([executable], cwd);
  expect(ran.stdout.split("\n").slice(0, 2)).toEqual([
    "object",
    expect.stringMatching(/^worker error: BuildMessage: ModuleNotFound resolving ".*lost\.mjs" \(entry point\)/),
  ]);
});

test("Bun.build() has the warning in its logs", async () => {
  using dir = tempDir("aot-worker-url-not-followed", {
    ...files,
    "build.mjs": `const built = await Bun.build({ entrypoints: ["./base.mjs", "./followed.mjs"], compile: { outfile: "./program", aot: true } });
for (const log of built.logs) if (log.message.includes("TS100082")) console.log(log.level + " " + log.position.file.split(/[\\\\/]/).pop() + ":" + log.position.line + ":" + log.position.column);
console.log("success " + built.success);
`,
  });
  const built = await run([bunExe(), "build.mjs"], String(dir));
  expect({ stdout: built.stdout, exitCode: built.exitCode }).toEqual({
    stdout: "warn base.mjs:2:20\nsuccess true\n",
    exitCode: 0,
  });
});

test("bun check --aot warns at the same starts", async () => {
  using dir = tempDir("aot-worker-url-not-followed", files);
  const checked = await run([bunExe(), "check", "--aot", "--threads=1", ...entryPoints], String(dir));
  expect({ warnedOf: placesOf(checked.stdout + checked.stderr), exitCode: checked.exitCode }).toEqual({
    warnedOf,
    exitCode: 0,
  });
});

test("bun run --aot warns and then runs the program, whose Worker starts from the file on disk", async () => {
  using dir = tempDir("aot-worker-url-not-followed", files);
  const ran = await run([bunExe(), "run", "--aot", "base.mjs"], String(dir));
  expect({ warnedOf: placesOf(ran.stderr), stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({
    warnedOf: ["base.mjs:2:20"],
    stdout: "worker says job\n",
    exitCode: 0,
  });
});

test("a test run is told nothing: there the Worker starts from the file on disk", async () => {
  using dir = tempDir("aot-worker-url-not-followed", {
    "job.mjs": files["job.mjs"],
    "starts.test.mjs": `import { expect, test } from "bun:test";
test("a Worker starts from a URL whose base nobody knows", async () => {
  const base = process.env.BASE_OF_JOBS ?? import.meta.url;
  const worker = new Worker(new URL("./job.mjs", base));
  const said = await new Promise(resolve => {
    worker.onmessage = event => resolve(event.data);
    worker.onerror = event => resolve(event.message);
  });
  worker.terminate();
  expect(said).toBe("job");
});
`,
  });
  const tested = await run([bunExe(), "test", "--aot", "./starts.test.mjs"], String(dir));
  expect({ warns: (tested.stdout + tested.stderr).includes("TS100082"), exitCode: tested.exitCode }).toEqual({
    warns: false,
    exitCode: 0,
  });
});
