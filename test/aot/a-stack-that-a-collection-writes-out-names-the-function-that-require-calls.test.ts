// A function of a node:vm context has the engine's own Error.captureStackTrace, which keeps its frames apart from the ones that Bun formats.
// The collection that finds one of those frames dead writes the stack out by itself, and may look into no realm for a name. Compiled code that
// calls `require` lists the function that `require` hands the file to. Its frame has the name of that function object: "anonymous" for a
// CommonJS file and for a module of Bun's library, none for an ES module.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

const files = {
  "main.cjs": `const vm = require("node:vm");
const context = vm.createContext({});
// The third stack below has bodies of library modules on it, and none of its frames is to be cut off.
vm.runInContext("Error.stackTraceLimit = 100;", context);
const kept = { common: [], module: [], library: [] };
globalThis.keep = function keep(from) {
  const error = new Error("kept");
  // The function of the context is on the stack that it captures, and dies with this call.
  vm.runInContext("(function (error) { Error.captureStackTrace(error); })", context)(error);
  kept[from].push(error);
};
require("./common.cjs");
require("./module.mjs");
// The library module that copies the built-in classes calls each function without parameters that it finds on Map.prototype, while it is first loaded.
Object.defineProperty(Map.prototype, "added", {
  configurable: true,
  value() {
    for (let i = 0; i < 20; ++i) globalThis.keep("library");
  },
});
require("node:util");
delete Map.prototype.added;
const frames = error => error.stack.split("\\n");
const listed = error =>
  frames(error)
    .map(frame => frame.slice(0, frame.indexOf("@")))
    .join(" < ");
const atOnce = { common: listed(kept.common[0]), module: listed(kept.module[0]), library: listed(kept.library[0]) };
console.log(JSON.stringify(atOnce.common));
console.log(JSON.stringify(atOnce.module));
// Which library module loads which is not what this test holds. The frame below the body of each is: the function that require called for it.
const isBodyOfLibraryModule = frame => /^module code@(?:node|internal|bun):/.test(frame);
const below = frames(kept.library[0]).filter((frame, index, all) => index > 0 && isBodyOfLibraryModule(all[index - 1]));
console.log(JSON.stringify([...new Set(below)]));
Bun.gc(true);
for (const from of ["common", "module", "library"])
  console.log(from, kept[from].filter(error => listed(error) === atOnce[from]).length, "of", kept[from].length);
`,
  "common.cjs": `for (let i = 0; i < 20; ++i) globalThis.keep("common");\n`,
  "module.mjs": `for (let i = 0; i < 20; ++i) globalThis.keep("module");\nexport {};\n`,
};

test("a captured stack below require reads the same after a collection has written it out", async () => {
  using dir = tempDir("aot-captured-stack-below-require", files);
  const folder = String(dir);
  const executable = join(folder, "main" + (isWindows ? ".exe" : ""));
  {
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", executable],
      cwd: folder,
      env: bunEnv,
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([build.stderr.text(), build.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: expect.not.stringMatching(/^error\b/m), exitCode: 0 });
  }
  await using ran = Bun.spawn({
    cmd: [executable],
    cwd: folder,
    env: { ...bunEnv, BUN_ENABLE_CRASH_REPORTING: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
  expect({ stdout, stderr, exitCode, signal: ran.signalCode }).toEqual({
    stdout: [
      // The function of the context, keep(), the body of the required file, the function that require called, the body of main.cjs.
      '" < keep <  < anonymous < "',
      '" < keep < module code <  < "',
      '["anonymous@[native code]"]',
      "common 20 of 20",
      "module 20 of 20",
      "library 20 of 20",
      "",
    ].join("\n"),
    stderr: "",
    exitCode: 0,
    signal: null,
  });
}, 600_000);
