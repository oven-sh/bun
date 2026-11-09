// `bun test --aot` makes a call of import() a turn later than an executable does, once. Nothing else about it differs: a test prints what the executable of the same files prints.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

const says = (name: string, ...imports: string[]) =>
  imports.map(imported => `import "./${imported}.mjs";\n`).join("") + `console.log("| ${name}");\n`;
const isIn = (name: string) => `.then(() => console.log("| ${name} is in"))`;

const projects: Record<string, { files: Record<string, string>; body: string[]; lines: string[] }> = {
  "three calls in one job": {
    files: { "a.mjs": says("a"), "b.mjs": says("b"), "c.mjs": says("c") },
    body: [
      `await Promise.all([`,
      `  import("./a.mjs")${isIn("a")},`,
      `  import("./b.mjs")${isIn("b")},`,
      `  import("./c.mjs")${isIn("c")},`,
      `]);`,
    ],
    lines: ["a", "b", "c", "a is in", "b is in", "c is in"],
  },
  "a call a job behind another": {
    files: { "a.mjs": `console.log("| a starts");\nawait 0;\nconsole.log("| a ends");\n`, "b.mjs": says("b") },
    body: [`const first = import("./a.mjs");`, `await null;`, `await Promise.all([first, import("./b.mjs")]);`],
    lines: ["a starts", "a ends", "b"],
  },
  "a call made once another has settled": {
    files: {
      "a.mjs": says("a"),
      "b.mjs": says("b"),
      "c.mjs": says("c", "c1"),
      "c1.mjs": says("c1", "c2"),
      "c2.mjs": says("c2"),
      "d.mjs": says("d", "c"),
    },
    body: [
      `await Promise.all([`,
      `  import("./a.mjs").then(() => import("./d.mjs"))${isIn("d")},`,
      `  import("./b.mjs")${isIn("b")},`,
      `  import("./c.mjs")${isIn("c")},`,
      `]);`,
    ],
    lines: ["a", "b", "b is in", "c2", "c1", "c", "d", "c is in", "d is in"],
  },
};

async function linesOf(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({
    cmd,
    cwd,
    env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stderr: exitCode ? stderr : "", exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return stdout
    .split("\n")
    .filter(line => line.startsWith("| "))
    .map(line => line.slice(2));
}

test.each(Object.entries(projects))("%s", async (_, { files, body, lines }) => {
  using dir = tempDir("aot-delayed-imports", {
    "package.json": `{ "name": "p" }`,
    ...files,
    "main.mjs": body.join("\n") + "\n",
    "a.test.mjs": `test("t", async () => {\n${body.map(line => "  " + line + "\n").join("")}});\n`,
  });
  const cwd = String(dir);
  await linesOf([bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", "compiled.exe"], cwd);
  expect({
    executable: await linesOf([join(cwd, "compiled.exe")], cwd),
    test: await linesOf([bunExe(), "test", "--aot"], cwd),
  }).toEqual({ executable: lines, test: lines });
});
