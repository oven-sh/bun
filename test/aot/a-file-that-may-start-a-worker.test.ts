import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { renameSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { testOneByOne as test } from "./supported";

// One file writes the path of a Worker's file and hands it to a function of another file, which says `new Worker(entry)`. The build doesn't follow `entry`.
// Where it can't read what some Worker starts from, it compiles every file of code whose path, URL or import with { type: "file" } the program writes out,
// and takes a file that hands on its own path for one that a Worker may start from. It looks at the program's own files, not at packages.
// Such a file may be there for another use, so it never stops the build: if it can't be compiled, it fails where a Worker loads it.
// Where the build reads what every Worker starts from, it compiles those files and no other.
const written: [string, (file: string) => string][] = [
  ["path.join() from import.meta.dir", file => `join(import.meta.dir, "src", "worker", "${file}")`],
  ["path.join() with one more argument", file => `join(import.meta.dir, "src/worker/${file}")`],
  ["path.join() from __dirname", file => `join(__dirname, "src", "worker", "${file}")`],
  ["path.join() from a constant that holds the folder", file => `join(folder, "src", "worker", "${file}")`],
  ["path.resolve()", file => `resolve(import.meta.dir, "src/worker/${file}")`],
  ["import.meta.dir +", file => `import.meta.dir + "/src/worker/${file}"`],
  ["a template", file => "`${import.meta.dir}/src/worker/" + file + "`"],
  ["require.resolve()", file => `require.resolve("./src/worker/${file}")`],
  ["import.meta.resolve()", file => `import.meta.resolve("./src/worker/${file}")`],
  ["a relative text", file => `"./src/worker/${file}"`],
  ["a path in a variable", file => `(held = join(import.meta.dir, "src/worker/${file}"), held)`],
  ["a path in a table", file => `({ job: join(import.meta.dir, "src/worker/${file}") }).job`],
  ["a URL", file => `new URL("./src/worker/${file}", import.meta.url)`],
  ["the text of a URL", file => `new URL("./src/worker/${file}", import.meta.url).href`],
  ["the path in a URL", file => `fileURLToPath(new URL("./src/worker/${file}", import.meta.url))`],
];
const ways = written.map(([name, write], index) => [name, write(`w${index + 1}.ts`)]);
const asWritten = ways.map(([name], index) => `SEEN ${name} | w${index + 1} 42`);

const imports = `import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { start } from "./src/spawn";
const folder = dirname(fileURLToPath(import.meta.url));
let held: string;
`;
const project: Record<string, string> = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": `{}`,
  "src/spawn.ts": `export const start = (entry: URL | string): Promise<string> => new Promise(resolve => {
  const worker = new Worker(entry);
  worker.onmessage = event => { resolve(event.data); worker.terminate(); };
  worker.onerror = event => { event.preventDefault(); resolve("error"); };
  worker.postMessage(21);
});
`,
  "src/worker/helper.ts": `export const double = (n: number): number => n * 2;\n`,
};
ways.forEach((_, index) => {
  project[`src/worker/w${index + 1}.ts`] = `import { double } from "./helper";
declare var self: any;
self.onmessage = (event: any) => { self.postMessage("w${index + 1} " + double(event.data)); };
`;
});
const say = ways.map(
  ([name, code]) => `console.log("SEEN " + ${JSON.stringify(name)} + " | " + (await start(${code})));\n`,
);

const seenBy = async (cwd: string, env: Record<string, string | undefined>, ...command: string[]) => {
  const { stdout, stderr, exitCode } = await run(command, cwd, env);
  return {
    seen: stdout.split("\n").filter(line => line.startsWith("SEEN ")),
    taken: [...stderr.matchAll(/^AOT load goes on \| with (\d+) more files that Workers start from$/gm)].map(match =>
      Number(match[1]),
    ),
    stderr: exitCode ? stderr : "",
    exitCode,
  };
};
const compiledOnly = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };
const saysWhatItTakes = { ...bunEnv, BUN_JSC_logAOTPhaseTimes: "1" };
const nothingSeen = { seen: [], stderr: "", exitCode: 0 };

async function compile(folder: string) {
  const executable = join(folder, isWindows ? "main.exe" : "main");
  const command = [bunExe(), "build", "--compile", "--aot", "--outfile", executable, "main.ts"];
  return { executable, built: await seenBy(folder, saysWhatItTakes, ...command) };
}

test("an executable holds the file of each Worker, however its path is written", async () => {
  using dir = tempDir("aot-file-that-may-start-a-worker", { ...project, "main.ts": imports + say.join("") });
  const plain = await seenBy(String(dir), bunEnv, bunExe(), "main.ts");
  expect(plain).toEqual({ seen: asWritten, taken: [], stderr: "", exitCode: 0 });
  const { executable, built } = await compile(String(dir));
  expect(built).toEqual({ ...nothingSeen, taken: [ways.length] });
  renameSync(join(String(dir), "src"), join(String(dir), "moved-away"));
  expect(await seenBy(String(dir), compiledOnly, executable)).toEqual(plain);
}, 240_000);

test("a test run compiles the file of each Worker, however its path is written", async () => {
  const files = {
    ...project,
    // A file that was compiled answers with what it said when the build read it.
    "workers.test.ts": `import { test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
${imports}test("the Workers answer", async () => {
  for (let n = 1; process.env.WRITES_OVER_WORKERS && n <= ${ways.length}; n++) {
    const file = process.cwd() + "/src/worker/w" + n + ".ts";
    writeFileSync(file, readFileSync(file, "utf8").replace('"w' + n + ' "', '"from disk "'));
  }
${say.join("")}});
`,
  };
  const see = async (flags: string[], env: Record<string, string>) => {
    using dir = tempDir("aot-file-that-may-start-a-worker", files);
    const command = [bunExe(), "test", "--timeout=60000", ...flags];
    return { ...(await seenBy(String(dir), { ...bunEnv, ...env }, ...command)), taken: [] };
  };
  const plain = await see([], {});
  expect(plain).toEqual({ seen: asWritten, taken: [], stderr: "", exitCode: 0 });
  expect(await see(["--aot"], { WRITES_OVER_WORKERS: "1" })).toEqual(plain);
}, 240_000);

// Two more starts that the build can't read. Each program is built by itself, so that none has its file compiled on account of another.
const starts: Record<string, Record<string, string>> = {
  "a function that its own file calls too": {
    "main.ts": `${imports}import { first } from "./src/first";
console.log("SEEN " + (await first) + " " + (await start(join(import.meta.dir, "src/worker/w2.ts"))));
`,
    "src/first.ts": `import { start } from "./spawn";\nexport const first = start(new URL("./worker/w1.ts", import.meta.url));\n`,
  },
  "the constructor under another name": {
    "main.ts": `${imports}console.log("SEEN " + (await start(join(import.meta.dir, "src/worker/w1.ts"))));\n`,
    "src/spawn.ts": project["src/spawn.ts"]
      .replace("new Worker(", "new Chosen(")
      .replace("export", `const Chosen = typeof Worker === "function" ? Worker : (undefined as never);\nexport`),
  },
};

for (const [name, files] of Object.entries(starts)) {
  test(`an executable holds the file of a Worker that is started by ${name}`, async () => {
    using dir = tempDir("aot-file-that-may-start-a-worker", { ...project, ...files });
    const plain = await seenBy(String(dir), bunEnv, bunExe(), "main.ts");
    expect({ ...plain, seen: plain.seen.length }).toEqual({ seen: 1, taken: [], stderr: "", exitCode: 0 });
    expect(plain.seen[0]).not.toContain("error");
    const { executable, built } = await compile(String(dir));
    expect({ ...built, taken: [] }).toEqual({ ...nothingSeen, taken: [] });
    renameSync(join(String(dir), "src"), join(String(dir), "moved-away"));
    expect(await seenBy(String(dir), compiledOnly, executable)).toEqual(plain);
  }, 240_000);
}

// A package writes many paths of its own files, and a file of a package that loads by a name from run time would open the whole program for a Worker that may never start.
test("what a package writes is not taken: its file is passed as an entry point", async () => {
  using dir = tempDir("aot-file-that-may-start-a-worker", {
    ...project,
    "main.ts": `import { begin } from "starts-its-own";\nconsole.log("SEEN " + (await begin()));\n`,
    "node_modules/starts-its-own/package.json": `{ "name": "starts-its-own", "version": "1.0.0", "main": "index.js" }`,
    "node_modules/starts-its-own/index.js": `const { join } = require("path");
const { Worker } = require("worker_threads");
const asked = globalThis.askedOfStartsItsOwn || {};
exports.begin = () => new Promise(resolve => {
  const worker = new Worker(asked.worker || join(__dirname, "lib", "worker.js"), { workerData: 21 });
  worker.on("message", data => { resolve(data); worker.terminate(); });
  worker.on("error", () => resolve("error"));
});
`,
    "node_modules/starts-its-own/lib/worker.js": `const { parentPort, workerData } = require("worker_threads");
parentPort.postMessage("of the package " + workerData * 2);
`,
  });
  const { executable, built } = await compile(String(dir));
  expect(built).toEqual({ ...nothingSeen, taken: [] });
  expect((await seenBy(String(dir), compiledOnly, executable)).seen).toEqual(["SEEN error"]);
  const command = [bunExe(), "build", "--compile", "--aot", "--outfile", executable, "main.ts"];
  const withEntryPoint = [...command, "./node_modules/starts-its-own/lib/worker.js"];
  expect(await seenBy(String(dir), bunEnv, ...withEntryPoint)).toEqual({ ...nothingSeen, taken: [] });
  expect((await seenBy(String(dir), compiledOnly, executable)).seen).toEqual(["SEEN of the package 42"]);
}, 240_000);

// A file hands itself to the function of the other file. Each way has a file of its own.
const itself: [string, string, string][] = [
  ["import.meta.url", "", "start(import.meta.url)"],
  ["import.meta.path", "", "start(import.meta.path)"],
  ["import.meta.filename", "", "start(import.meta.filename)"],
  ["__filename", "", "start(__filename)"],
  ["a URL made of import.meta.url", "", "start(new URL(import.meta.url))"],
  ["the path in import.meta.url, in a constant", "const own = fileURLToPath(import.meta.url);\n", "start(own)"],
  ["import.meta?.url", "", "start(import.meta?.url)"],
  ["import.meta under a key in brackets", "", 'start(import.meta["url"])'],
  ["import.meta taken apart", "const { url } = import.meta;\n", "start(url)"],
  ["import.meta whole", "", "startBy(import.meta)"],
  ["the text of a URL made of import.meta.filename", "", "start(pathToFileURL(import.meta.filename).href)"],
  ["through a promise", "", "Promise.resolve(import.meta.url).then(start)"],
];

test("an executable starts a Worker from a file that hands itself to a function of another file", async () => {
  const jobs = itself.map(([, before, code], index) => [
    `src/job${index + 1}.ts`,
    `import { fileURLToPath, pathToFileURL } from "node:url";
import { start } from "./spawn";
import { startBy } from "./spawn-by";
declare var self: any;
${before}export const run = () => ${code};
export const used = [typeof fileURLToPath, typeof pathToFileURL, typeof start, typeof startBy];
if (!Bun.isMainThread) self.onmessage = (event: any) => { self.postMessage("job${index + 1} " + event.data * 2); };
`,
  ]);
  const main = itself.map(
    ([name], index) =>
      `console.log("SEEN " + ${JSON.stringify(name)} + " | " + (await (await import("./src/job${index + 1}")).run()));\n`,
  );
  using dir = tempDir("aot-file-that-may-start-a-worker", {
    ...project,
    ...Object.fromEntries(jobs),
    "src/spawn-by.ts": `import { start } from "./spawn";\nexport const startBy = (meta: { url: string }) => start(meta.url);\n`,
    // It asks built-in functions about its own path and makes other texts of it: nobody else gets the path, so no Worker starts from this file.
    "src/keeps-to-itself.ts": `import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
const own = fileURLToPath(import.meta.url);
export const made = [dirname(own), own.endsWith(".ts"), own + ".map", \`\${import.meta.url}#made\`, __filename.length];
`,
    "main.ts": main.join("") + `console.log("SEEN " + (await import("./src/keeps-to-itself")).made.length);\n`,
  });
  const plain = await seenBy(String(dir), bunEnv, bunExe(), "main.ts");
  expect(plain).toEqual({
    seen: [...itself.map(([name], index) => `SEEN ${name} | job${index + 1} 42`), "SEEN 5"],
    taken: [],
    stderr: "",
    exitCode: 0,
  });
  const { executable, built } = await compile(String(dir));
  expect(built).toEqual({ ...nothingSeen, taken: [itself.length] });
  renameSync(join(String(dir), "src"), join(String(dir), "moved-away"));
  expect(await seenBy(String(dir), compiledOnly, executable)).toEqual(plain);
}, 240_000);

// None of them can be compiled: two are written for a browser, the others are no code at all.
const onlyRead: Record<string, string> = {
  "pages/by-url.js": `import "./a-file-that-only-the-browser-finds.js";\n`,
  "pages/by-path.js": `const broken = ;;; ) {\n`,
  "pages/by-text.js": `const broken = ;;; ) {\n`,
  "pages/embedded.js": `import "./a-file-that-only-the-browser-finds.js";\n`,
  "pages/straight-by-url.js": `const broken = ;;; ) {\n`,
  "pages/straight-by-path.js": `const broken = ;;; ) {\n`,
  "pages/straight-by-text.js": `const broken = ;;; ) {\n`,
};
const reads = `import { readFileSync } from "node:fs";
import embedded from "./pages/embedded.js" with { type: "file" };
const read = (file: URL | string) => { try { return readFileSync(file, "utf8").length; } catch { return -1; } };
const pages = [
  new URL("./pages/by-url.js", import.meta.url),
  join(import.meta.dir, "pages", "by-path.js"),
  "./pages/by-text.js",
];
console.log("SEEN the pages | " + pages.map(read).length + " " + (await Bun.file(embedded).text()).length);
// What goes straight to a built-in function reaches nobody who could start a Worker from it.
const attempt = (read: () => unknown) => { try { read(); } catch {} return 1; };
const straight =
  attempt(() => readFileSync(new URL("./pages/straight-by-url.js", import.meta.url))) +
  attempt(() => readFileSync(fileURLToPath(new URL("./pages/straight-by-url.js", import.meta.url)))) +
  attempt(() => readFileSync(join(import.meta.dir, "pages", "straight-by-path.js"))) +
  attempt(() => Bun.file("./pages/straight-by-text.js").size);
console.log("SEEN read straight | " + straight);
`;

test("where the build reads what every Worker starts from, a file that the program only reads is not compiled", async () => {
  const main = `${imports}${reads}const worker = new Worker(new URL("./src/worker/w1.ts", import.meta.url));
worker.onmessage = event => { console.log("SEEN at the constructor | " + event.data); worker.terminate(); };
worker.postMessage(21);
console.log("SEEN " + typeof start);
`;
  using dir = tempDir("aot-file-that-may-start-a-worker", {
    ...project,
    ...onlyRead,
    "main.ts": main,
    "src/spawn.ts": `export const start = () => {};\n`,
  });
  const { executable, built } = await compile(String(dir));
  expect(built).toEqual({ ...nothingSeen, taken: [1] });
  expect((await seenBy(String(dir), compiledOnly, executable)).seen).toEqual([
    "SEEN the pages | 3 50",
    "SEEN read straight | 4",
    "SEEN function",
    "SEEN at the constructor | w1 42",
  ]);
}, 240_000);

test("a file that may start a Worker and can't be compiled stops no build, and fails where a Worker loads it", async () => {
  const main = `${imports}${reads}console.log("SEEN a file of code | " + (await start(join(import.meta.dir, "src/worker/w1.ts"))));
for (const page of pages) console.log("SEEN a page | " + (await start(page)));
console.log("SEEN the embedded page | " + (await start(embedded)));
`;
  using dir = tempDir("aot-file-that-may-start-a-worker", { ...project, ...onlyRead, "main.ts": main });
  const plain = await seenBy(String(dir), bunEnv, bunExe(), "main.ts");
  expect(plain.seen).toEqual([
    "SEEN the pages | 3 50",
    "SEEN read straight | 4",
    "SEEN a file of code | w1 42",
    ...pages().map(() => "SEEN a page | error"),
    "SEEN the embedded page | error",
  ]);
  const { executable, built } = await compile(String(dir));
  expect(built).toEqual({ ...nothingSeen, taken: [5] });
  expect((await seenBy(String(dir), compiledOnly, executable)).seen).toEqual(plain.seen);
}, 240_000);

function pages() {
  return ["a URL", "a path", "a relative text"];
}
