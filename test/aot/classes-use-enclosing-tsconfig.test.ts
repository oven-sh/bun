import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

const held = `export class Held { late: string | undefined; first = 1; }\n`;
const marked = `
function mark(target: any, key: string) { (target.marked ??= []).push(key); }
export class Marked { @mark one = 1; @mark two(): number { return 2; } }
`;
const dependency = (name: string, text: string, options?: object) => ({
  [`node_modules/${name}/package.json`]: JSON.stringify({ name, version: "1.0.0", main: "index.ts" }),
  [`node_modules/${name}/index.ts`]: text,
  ...(options ? { [`node_modules/${name}/tsconfig.json`]: JSON.stringify({ compilerOptions: options }) } : {}),
});
const files = {
  "tsconfig.json": JSON.stringify({ compilerOptions: { useDefineForClassFields: false, strict: true } }),
  ...dependency("says-nothing", held),
  ...dependency("assigns", held, { useDefineForClassFields: false }),
  ...dependency("defines", held, { useDefineForClassFields: true }),
  ...dependency("decorates", marked, { experimentalDecorators: true }),
  ...dependency("decorates-and-defines", marked, { experimentalDecorators: true, useDefineForClassFields: true }),
  "main.ts": `
    import { Held as SaysNothing } from "says-nothing";
    import { Held as Assigns } from "assigns";
    import { Held as Defines } from "defines";
    import { Marked } from "decorates";
    import { Marked as MarkedAndDefined } from "decorates-and-defines";
    class Own { late: string | undefined; first = 1; }
    for (const made of [new Own(), new SaysNothing(), new Assigns(), new Defines()]) console.log(Object.keys(made).join());
    for (const made of [new Marked(), new MarkedAndDefined()]) console.log(Object.keys(made).join(), (made as any).marked.join(), made.two());
  `,
};

async function run(cwd: string, cmd: string[]) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, cwd);
  return { stdout, stderr, exitCode };
}

test("fields and decorators of a file go by the tsconfig.json around that file, as without --aot", async () => {
  using dir = tempDir("aot-classes-by-tsconfig", files);
  const answers = [];
  for (const flags of [[], ["--aot"]]) {
    const outfile = join(String(dir), "out" + flags.length + (isWindows ? ".exe" : ""));
    const built = await run(String(dir), [bunExe(), "build", "--compile", ...flags, "./main.ts", "--outfile", outfile]);
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    answers.push(await run(String(dir), [outfile]));
  }
  expect(answers[0].stdout.split("\n").slice(0, 4)).toEqual(["first", "first", "first", "late,first"]);
  expect(answers[1]).toEqual(answers[0]);
}, 120_000);
