import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { buildEnvironment, compileCommand, withThreads } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

// A file of re-exports in a package that says `"sideEffects": false` is a barrel: a statement that imports one name of it loads the one file behind that name.
// An entry point is no barrel: a Worker that starts from it runs all of it, and an `import()` that the build traces to it may read any name.
// The build can find that a file is an entry point after it has loaded the file as a barrel. Then it scans the file again, and the rest is loaded.
// Before, the rest came only with a second load of the file, which the build made where the file's answer for `import.meta.main` changed. After a store to
// `Bun.main` no file has such an answer. A barrel that was loaded after the store stayed a barrel, and the executable ran without the files behind the names
// that no statement imports.

// The build finds plugin.mjs by a name. So the two barrels behind it are loaded one round after main.mjs and its store, whatever the threads do.
const files = {
  "main.mjs": `import { load } from "./loader.mjs";
Bun.main = Bun.main;
await load("./plugin.mjs");
console.log("SEEN the plugin is loaded");
`,
  "loader.mjs": `export const load = name => import(name);\n`,
  "plugin.mjs": `import { A } from "./icons/index.mjs";
import { Circle } from "./shapes/index.mjs";
import { load } from "./loader.mjs";
console.log("SEEN imported | " + A + " | " + Circle);
const all = await load("./icons/index.mjs");
console.log("SEEN under a name that a function is handed | " + Object.keys(all) + " | " + all.B);
const worker = new Worker(new URL("./shapes/index.mjs", import.meta.url));
worker.onmessage = event => {
  console.log("SEEN in the Worker | " + event.data);
  worker.terminate();
};
`,
  "icons/package.json": `{ "name": "icons", "type": "module", "sideEffects": false }`,
  "icons/index.mjs": `export { A } from "./a.mjs";\nexport { B } from "./b.mjs";\n`,
  "icons/a.mjs": `export const A = "a";\n`,
  "icons/b.mjs": `export const B = "b";\n`,
  "shapes/package.json": `{ "name": "shapes", "type": "module", "sideEffects": false }`,
  "shapes/index.mjs": `export { Circle } from "./circle.mjs";\nexport { Square } from "./square.mjs";\n`,
  "shapes/circle.mjs": `export const Circle = "circle";\n`,
  "shapes/square.mjs": `export const Square = "square";\nif (!Bun.isMainThread) postMessage("square.mjs ran");\n`,
};
const seen = [
  "SEEN imported | a | circle",
  "SEEN under a name that a function is handed | A,B | b",
  "SEEN the plugin is loaded",
  "SEEN in the Worker | square.mjs ran",
];
const seenIn = (text: string) => text.split("\n").filter(line => line.startsWith("SEEN "));

test("a barrel that the build finds to be an entry point is in the executable whole", async () => {
  using dir = tempDir("aot-barrel-that-becomes-an-entry-point", files);
  const cwd = String(dir);
  const plain = await run([bunExe(), "main.mjs"], cwd, bunEnv);
  const executable = join(cwd, isWindows ? "main.exe" : "main");
  // One thread: a Bun with assertions can crash in a build of several (#48169), and what the load makes of this program does not go by their number.
  const command = [bunExe(), ...compileCommand, withThreads(1), "--outfile", executable, "main.mjs"];
  const built = await run(command, cwd, { ...bunEnv, [buildEnvironment.logsPhaseTimes]: "1" });
  const rounds = built.stderr.split("\n").filter(line => line.startsWith("AOT round of Load"));
  const count = (what: RegExp) => rounds.reduce((sum, line) => sum + Number(what.exec(line)?.[1]), 0);
  const ran = built.exitCode === 0 ? await run([executable], cwd, bunEnv) : undefined;
  expect({
    plain: seenIn(plain.stdout),
    build: {
      loadedAgain: count(/(\d+) loaded again/),
      scannedAgain: count(/(\d+) scanned again/),
      stderr: built.exitCode ? built.stderr : "",
      exitCode: built.exitCode,
    },
    executable: ran && { seen: seenIn(ran.stdout), stderr: ran.exitCode ? ran.stderr : "", exitCode: ran.exitCode },
  }).toEqual({
    plain: seen,
    // Each of the two barrels is scanned again. No file is read and parsed a second time.
    build: { loadedAgain: 0, scannedAgain: 2, stderr: "", exitCode: 0 },
    executable: { seen, stderr: "", exitCode: 0 },
  });
});
