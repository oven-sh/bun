import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { slot, unsupported } from "./run-programs";

const shows = `const shown = built => console.log(built.success, built.outputs.map(output => output.kind + " " + output.loader).join());\nconst here = process.cwd() + "/";\n`;
const sources = {
  "entry.ts": `import { double } from "./helper";\nexport const answer: number = double(21);\nconsole.log(answer);\n`,
  "helper.ts": `export function double(x: number): number { return x * 2; }\n`,
  "style.css": `.a { color: red; & .b { margin: calc(1px + 2px); } }\n`,
  "page.tsx": `import "./style.css";\nexport function Page({ name }: { name: string }) { return <div className="a">{name}</div>; }\n`,
  "macro.ts": `export function made() { return "made " + [1, 2].map(x => x * 2).join(); }\nexport function reaches() { return Bun.color("red", "hex"); }\n`,
  "uses-a-macro.ts": `import { made } from "./macro.ts" with { type: "macro" };\nconsole.log(made());\n`,
  "uses-a-macro-that-reaches.ts": `import { reaches } from "./macro.ts" with { type: "macro" };\nconsole.log(reaches());\n`,
};
const programs: Record<string, { source: string; whole: string; trimmed?: string }> = {
  "Bun.build of a file": {
    source: `${shows}const built = await Bun.build({ entrypoints: [here + "entry.ts"], target: "bun" });\nshown(built);\nconsole.log((await built.outputs[0].text()).includes("x * 2"));\n`,
    whole: "true entry-point ts\ntrue\n",
  },
  "build imported from bun, of a component and its style sheet, minified": {
    source: `import { build } from "bun";\n${shows}shown(await build({ entrypoints: [here + "page.tsx"], target: "browser", external: ["react", "react/jsx-dev-runtime", "react/jsx-runtime"], minify: true }));\n`,
    whole: "true entry-point tsx,asset tsx\n",
  },
  "Bun.build with a plugin of the program's own": {
    source: `${shows}const built = await Bun.build({ entrypoints: [here + "entry.ts"], target: "bun", plugins: [{ name: "mine", setup(builder) { builder.onLoad({ filter: /helper\\.ts$/ }, () => ({ contents: "export function double(x) { return x * 3; }", loader: "js" })); } }] });\nshown(built);\nconsole.log((await built.outputs[0].text()).includes("x * 3"));\n`,
    whole: "true entry-point ts\ntrue\n",
  },
  "Bun.build of a file that calls a macro": {
    source: `${shows}const built = await Bun.build({ entrypoints: [here + "uses-a-macro.ts"], target: "bun" });\nshown(built);\nconsole.log((await built.outputs[0].text()).includes("made 2,4"));\n`,
    whole: "true entry-point ts\ntrue\n",
  },
  "Bun.build of a file whose macro reaches for what nobody named: the build fails, and the program goes on": {
    source: `${shows}shown(await Bun.build({ entrypoints: [here + "uses-a-macro-that-reaches.ts"], target: "bun", throw: false }));\nconsole.log("goes on");\n`,
    whole: "true entry-point ts\ngoes on\n",
    trimmed: "false \ngoes on\n",
  },
  "Bun.Transpiler": {
    source: `const transpiler = new Bun.Transpiler({ loader: "tsx" });\nconsole.log(transpiler.transformSync("const x: number = 1; export default x;").trim());\nconsole.log(JSON.stringify(transpiler.scanImports("import a from 'a'; import('b');")));\n`,
    whole: `const x = 1;\nexport default x;\n[{"kind":"import-statement","path":"a"},{"kind":"dynamic-import","path":"b"}]\n`,
  },
};

async function run(cmd: string[], cwd: string) {
  await using child = Bun.spawn({ cmd, cwd, env: { ...bunEnv, NO_COLOR: "1" }, stdout: "pipe", stderr: "pipe", timeout: 90_000, killSignal: "SIGKILL" });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, stderr, exitCode };
}

using probe = tempDir("bundler-probe", { "hello.ts": "console.log(1);" });
const probed = Bun.spawnSync({ cmd: [bunExe(), "build", "--compile", "--compile-trim-runtime", "hello.ts", "--outfile", "hello"], cwd: String(probe), env: bunEnv, stderr: "pipe" });

(probed.exitCode !== 0 || unsupported || isWindows ? describe.skip : describe.concurrent)("what turns text into text opens nothing: the world is closed, and it works in a trimmed executable as in the whole one", () => {
  for (const [name, { source, whole, trimmed = whole }] of Object.entries(programs)) {
    test(
      name,
      () =>
        slot(async () => {
          using dir = tempDir("bundler", { "program.mjs": source, ...sources });
          const found: Record<string, unknown> = {};
          for (const [kind, flags] of [["whole", []], ["trimmed", ["--compile-trim-runtime"]]] as const) {
            const build = await run([bunExe(), "build", "--compile", "--aot", "--aot-explain=runtime-use", ...flags, "program.mjs", "--outfile", kind], String(dir));
            expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: expect.not.stringMatching(/^error\b/m), exitCode: 0 });
            const ran = await run([join(String(dir), kind)], String(dir));
            found[kind] = { world: /^aot: runtime use: (closed|open)\b/m.exec(build.stderr)?.[1], stdout: ran.stdout, exitCode: ran.exitCode };
          }
          expect(found).toEqual({ whole: { world: "closed", stdout: whole, exitCode: 0 }, trimmed: { world: "closed", stdout: trimmed, exitCode: 0 } });
        }),
      600_000,
    );
  }
});
