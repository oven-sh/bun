import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { renameSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const web = `postMessage("answers");\n`;
const starts: [string, string][] = [
  ["plus", `new Worker(__dirname + "/plus.js")`],
  ["template", "new Worker(`${__dirname}/template.js`)"],
  ["joined", `new Worker(require("node:path").join(__dirname, "joined.js"))`],
  ["resolved", `new Worker(require("node:path").resolve(__dirname, "resolved.js"))`],
  ["besideItself", `new Worker(require("node:path").dirname(__filename) + "/besideItself.js")`],
];
const files = {
  "package.json": `{ "name": "p" }`,
  "src/starts.js": starts.map(([name, code]) => `exports.${name} = () => ${code};\n`).join(""),
  ...Object.fromEntries(starts.map(([name]) => [`src/${name}.js`, web])),
  "src/itself.js": `const { Worker, isMainThread, parentPort } = require("node:worker_threads");
if (isMainThread) exports.itself = () => new Worker(__filename);
else parentPort.postMessage("answers");
`,
  "main.cjs": `const all = { ...require("./src/starts.js"), ...require("./src/itself.js") };
(async () => {
  for (const name in all) {
    const worker = all[name]();
    const got = await new Promise(done => {
      const take = value => done(value?.data ?? value);
      worker.onmessage = take;
      worker.on?.("message", take);
      worker.onerror = () => done("error");
      worker.on?.("error", () => done("error"));
    });
    console.log("SEEN", name, got);
    await worker.terminate();
  }
  process.exit(0);
})();
`,
};
const answers = [...starts.map(([name]) => name), "itself"].map(name => `SEEN ${name} answers`);
const seenIn = (text: string) => text.split("\n").filter(line => line.startsWith("SEEN"));

test("each Worker answers in an executable whose sources are moved away", async () => {
  using dir = tempDir("aot-a-worker-starts-from-dirname", files);
  const cwd = String(dir);
  expect(seenIn((await run([bunExe(), "run", "main.cjs"], cwd, bunEnv)).stdout)).toEqual(answers);
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", "compiled"], cwd, bunEnv);
  expect({ exitCode: built.exitCode, said: built.exitCode ? built.stdout + built.stderr : "" }).toEqual({
    exitCode: 0,
    said: "",
  });
  renameSync(join(cwd, "src"), join(cwd, "moved-away"));
  expect(seenIn((await run([join(cwd, "compiled")], cwd, bunEnv)).stdout)).toEqual(answers);
});
