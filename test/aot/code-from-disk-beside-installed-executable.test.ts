import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "src/main.ts": `import path from "node:path";
import { counter, bump } from "./state";
(globalThis as any).bumpOfProgram = bump;
bump();
for (const file of process.argv.slice(2)) await import(path.resolve(file));
console.log("the program sees", counter.value);
`,
  "src/state.ts": `export const counter = { value: 0 };
export function bump() {
  return ++counter.value;
}
`,
};
const plugin = `import { bump, counter } from "../src/state.ts";
bump();
console.log("the plug-in sees", counter.value, bump === globalThis.bumpOfProgram);
`;

test("a plug-in finds the compiled module where the program is installed elsewhere", async () => {
  using dir = tempDir("aot-code-from-disk-installed", files);
  const project = String(dir);
  const name = process.platform === "win32" ? "app.exe" : "app";
  const flags = ["--compile", "--aot", "--aot-allow-code-from-disk"];
  const build = await run(
    [bunExe(), "build", ...flags, "./src/main.ts", "--outfile", join("dist", name)],
    project,
    bunEnv,
  );
  expect({ stderr: build.exitCode === 0 ? "" : build.stderr, exitCode: build.exitCode }).toEqual({
    stderr: "",
    exitCode: 0,
  });
  expect(readFileSync(join(project, "dist", name)).includes(project)).toBe(false);

  using other = tempDir("aot-code-from-disk-elsewhere", { "plugins/plugin.mjs": plugin, "somewhere/.keep": "" });
  const installed = String(other);
  mkdirSync(join(installed, "dist"));
  cpSync(join(project, "dist", name), join(installed, "dist", name));
  rmSync(project, { recursive: true });
  const result = await run(
    [join(installed, "dist", name), join(installed, "plugins/plugin.mjs")],
    join(installed, "somewhere"),
    bunEnv,
  );
  expect({
    stdout: result.stdout,
    stderr: result.exitCode === 0 ? "" : result.stderr,
    exitCode: result.exitCode,
  }).toEqual({
    stdout: "the plug-in sees 2 true\nthe program sees 2\n",
    stderr: "",
    exitCode: 0,
  });
}, 60_000);
