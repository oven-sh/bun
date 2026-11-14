import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// The import() of a CommonJS file hands every pending import() to the module loader. The vm timeout fires during that handoff.
const n = 300;
const numbers = Array.from({ length: n }, (_, i) => i);
const files: Record<string, string> = {
  "last.cjs": "module.exports = 0;\n",
  "main.mjs": `import vm from "node:vm";
const all = [];
${numbers.map(i => `all.push(import("./leaf${i}.mjs"));`).join("\n")}
await null;
await null;
await null;
${numbers.map(i => `all.push(import("./above${i}.mjs"));`).join("\n")}
function ask() {
  return import("./last.cjs");
}
try {
  vm.runInNewContext("ask()", { ask }, { timeout: Number(process.env.TIME_LIMIT) });
} catch (error) {
  if (error.code !== "ERR_SCRIPT_EXECUTION_TIMEOUT") throw error;
}
const results = await Promise.allSettled(all);
console.log(results.filter(result => result.status === "fulfilled").length);
`,
};
for (const i of numbers) {
  files[`leaf${i}.mjs`] = `export default ${i};\n`;
  files[`above${i}.mjs`] = `import "./file${i}.cjs";\nexport default ${i};\n`;
  files[`file${i}.cjs`] = `module.exports = ${i};\n`;
}

test("pending import() calls settle after a vm timeout interrupts another import()", async () => {
  using dir = tempDir("aot-imports-after-vm-timeout", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable], String(dir));
  expect({
    stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], exitCode: 0 });
  for (let attempt = 0; attempt < 4; attempt++) {
    for (const limit of ["1", "2", "3", "5"]) {
      const ran = await run([executable], String(dir), { ...bunEnv, TIME_LIMIT: limit });
      expect({ limit, stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({
        limit,
        stdout: `${2 * n}\n`,
        stderr: "",
        exitCode: 0,
      });
    }
  }
}, 240_000);
