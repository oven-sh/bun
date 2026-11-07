// `bun run` and `bun test` compile JSX and decorators by the tsconfig.json of the working directory. With --aot they are checked as they are compiled.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./with-compiler";

const shared = {
  target: "ESNext",
  module: "Preserve",
  moduleResolution: "bundler",
  noEmit: true,
  types: [] as string[],
  strict: true,
};
const config = (more: object = {}) => JSON.stringify({ compilerOptions: { ...shared, ...more } });

async function run(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({ cmd: [bunExe(), ...args], cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { said: stdout + stderr, exitCode };
}

const passed = (said: string) => [...said.matchAll(/^\(pass\) (.*?)(?: \[.*\])?$/gm)].map(match => match[1]).sort();
const codes = (said: string) => [...new Set([...said.matchAll(/\bTS\d+/g)].map(match => match[0]))].sort();

const jsxRuntime = (prefix: string) => ({
  "jsx-runtime.ts": `export function jsx(tag: string, props: { children?: unknown }): string { return ${JSON.stringify(prefix)} + tag + ":" + String(props.children); }\nexport const jsxs = jsx;\nexport const jsxDEV = jsx;\nexport const Fragment = "fragment";\nexport namespace JSX {\n  export type Element = string;\n  export interface IntrinsicElements { [name: string]: { children?: unknown } }\n}\n`,
  "jsx-dev-runtime.ts": `export * from "./jsx-runtime";\n`,
});
const under = (folder: string, files: Record<string, string>) =>
  Object.fromEntries(Object.entries(files).map(([name, text]) => [`${folder}/${name}`, text]));

test("bun test --aot takes decorators as bun test compiles them: by the tsconfig.json of the working directory", async () => {
  const marked = (mark: string) =>
    `let count = 0;\n${mark}\n@mark\nclass Marked {}\ntest("marked", () => { console.log(Marked.name + " got " + count); });\n`;
  using dir = tempDir("tsconfig-governs-each-file", {
    "tsconfig.json": config({ experimentalDecorators: false }),
    "legacy/tsconfig.json": config({ experimentalDecorators: true }),
    "legacy/standard-style.test.ts": marked(
      `function mark(value: Function, context: ClassDecoratorContext) { count = arguments.length; }`,
    ),
    "legacy/legacy-style.test.ts": marked(`function mark(target: Function) { count = arguments.length; }`),
  });
  for (const aot of [[], ["--aot"]]) {
    const outside = await run(String(dir), "test", ...aot, "legacy/standard-style.test.ts");
    expect(codes(outside.said)).toEqual([]);
    expect(outside.said).toContain("Marked got 2");
    expect(outside.exitCode).toBe(0);
    const inside = await run(join(String(dir), "legacy"), "test", ...aot, "legacy-style.test.ts");
    expect(codes(inside.said)).toEqual([]);
    expect(inside.said).toContain("Marked got 1");
    expect(inside.exitCode).toBe(0);
  }
});

const runtime = (name: string, result: string, made: string) => ({
  [`node_modules/${name}/package.json`]: JSON.stringify({ name, version: "1.0.0" }),
  [`node_modules/${name}/jsx-runtime.ts`]: `export function jsx(tag: string, props: { children?: unknown }): ${result} { return ${made}; }\nexport const jsxs = jsx;\nexport const jsxDEV = jsx;\nexport const Fragment = "fragment";\nexport namespace JSX {\n  export type Element = ${result};\n  export interface IntrinsicElements { [name: string]: { children?: unknown } }\n}\n`,
  [`node_modules/${name}/jsx-dev-runtime.ts`]: `export * from "./jsx-runtime";\n`,
});

test("bun run --aot takes JSX as bun run compiles it: by the tsconfig.json of the working directory", async () => {
  using dir = tempDir("tsconfig-governs-each-file", {
    ...runtime("text-jsx", "string", `tag + ":" + String(props.children)`),
    ...runtime("length-jsx", "number", `(tag + ":" + String(props.children)).length`),
    "tsconfig.json": config({ jsx: "react-jsx", jsxImportSource: "text-jsx" }),
    "inner/tsconfig.json": config({ jsx: "react-jsx", jsxImportSource: "length-jsx" }),
    "inner/text.tsx": `const shown: string = <b>x</b>;\nconsole.log(shown);\n`,
    "inner/length.tsx": `const shown: number = <b>x</b>;\nconsole.log(shown);\n`,
  });
  for (const aot of [[], ["--aot"]]) {
    expect(await run(String(dir), "run", ...aot, "inner/text.tsx")).toEqual({ said: "b:x\n", exitCode: 0 });
    expect(await run(join(String(dir), "inner"), "run", ...aot, "length.tsx")).toEqual({ said: "3\n", exitCode: 0 });
  }
});

test("a @jsxImportSource comment counts wherever it stands in the file, as without --aot", async () => {
  using dir = tempDir("tsconfig-governs-each-file", {
    ...under("own-jsx", jsxRuntime("own ")),
    "tsconfig.json": config({ jsx: "react-jsx" }),
    "late.test.tsx": `import { expect, test } from "bun:test";\n/** @jsxImportSource ./own-jsx */\ntest("late", () => { expect(<b>x</b>).toBe("own b:x"); });\n`,
  });
  for (const aot of [[], ["--aot"]]) {
    const { said, exitCode } = await run(String(dir), "test", ...aot);
    expect(codes(said)).toEqual([]);
    expect(passed(said)).toEqual(["late"]);
    expect(exitCode).toBe(0);
  }
});
