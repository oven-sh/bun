import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const data = {
  "t.txt": "orig",
  "t.json": `{ "a": "orig", "nested": { "b": "orig" } }`,
  "t.toml": `a = "orig"\n`,
  "t.yaml": `a: orig\n`,
  "t.ts": `export default "orig";\n`,
};

// Each form: what the reader imports, what it prints, the path that is mocked and what the factory returns.
const forms: Record<string, [imports: string, printed: string, path: string, mock: string]> = {
  "text": [`import t from "./t.txt";`, `t`, "./t.txt", `{ default: "mocked" }`],
  "text-by-attribute": [`import t from "./t.txt" with { type: "text" };`, `t`, "./t.txt", `{ default: "mocked" }`],
  "text-namespace": [
    `import * as t from "./t.txt" with { type: "text" };`,
    `t.default`,
    "./t.txt",
    `{ default: "mocked" }`,
  ],
  "text-both-ways": [
    `import t from "./t.txt" with { type: "text" }; import u from "./t.txt";`,
    `t + " " + u`,
    "./t.txt",
    `{ default: "mocked" }`,
  ],
  "file-by-attribute": [
    `import t from "./t.txt" with { type: "file" };`,
    `t.endsWith(".txt") ? "a path" : t`,
    "./t.txt",
    `{ default: "mocked" }`,
  ],
  "code-as-text": [`import t from "./t.ts" with { type: "text" };`, `t.trim()`, "./t.ts", `{ default: "mocked" }`],
  "json-as-text": [`import t from "./t.json" with { type: "text" };`, `t`, "./t.json", `{ default: "mocked" }`],
  "json": [`import t from "./t.json";`, `t.a`, "./t.json", `{ default: { a: "mocked" } }`],
  "json-nested": [`import t from "./t.json";`, `t.nested.b`, "./t.json", `{ default: { nested: { b: "mocked" } } }`],
  "json-by-attribute": [
    `import t from "./t.json" with { type: "json" };`,
    `t.a`,
    "./t.json",
    `{ default: { a: "mocked" } }`,
  ],
  "json-by-name": [`import { a } from "./t.json";`, `a`, "./t.json", `{ a: "mocked", default: { a: "mocked" } }`],
  "json-object-by-name": [`import { nested } from "./t.json";`, `nested.b`, "./t.json", `{ nested: { b: "mocked" } }`],
  "toml": [`import t from "./t.toml";`, `t.a`, "./t.toml", `{ default: { a: "mocked" } }`],
  "yaml": [`import t from "./t.yaml";`, `t.a`, "./t.yaml", `{ default: { a: "mocked" } }`],
};

function filesOf(write: (name: string, form: (typeof forms)[string]) => Record<string, string>) {
  const files: Record<string, string> = {};
  for (const [name, form] of Object.entries(forms)) {
    for (const [path, text] of Object.entries({ ...data, ...write(name, form) })) files[`${name}/${path}`] = text;
  }
  return files;
}

async function runTests(directory: string, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, bunEnv);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  // A crash prints only there, and the comparison below would hide it.
  if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
  return { stdout: stdout.split("\n").sort(), results: results.sort(), exitCode };
}

async function expectCompiledToRunAsPlain(files: Record<string, string>) {
  using dir = tempDir("mock-module-of-data-files", files);
  const plain = await runTests(String(dir));
  expect(plain.results.filter(result => result.startsWith("fail"))).toEqual([]);
  expect(plain.results.length).toBe(Object.keys(forms).length);
  expect(plain.stdout.filter(line => line.includes("mocked")).length).toBe(Object.keys(forms).length);
  expect(await runTests(String(dir), "--aot")).toEqual(plain);
}

// TODO: plain `bun test` prints one line fewer than this expects since its mocks were reworked.
test.todo("mock.module replaces what a file of data that is loaded exports", async () => {
  await expectCompiledToRunAsPlain(
    filesOf((name, [imports, printed, path, mock]) => ({
      "reader.ts": `${imports}\nexport const read = () => String(${printed});`,
      "one.test.ts": `
        import { mock, test } from "bun:test";
        import { read } from "./reader";
        const before = read();
        mock.module(${JSON.stringify(path)}, () => (${mock}));
        test(${JSON.stringify(name)}, () => { console.log(${JSON.stringify(name)}, before, "|", read()); });`,
    })),
  );
});

test("mock.module answers for a file of data that has not loaded", async () => {
  await expectCompiledToRunAsPlain(
    filesOf((name, [imports, printed, path, mock]) => ({
      "reader.ts": `${imports}\nexport const read = () => String(${printed});`,
      "one.test.ts": `
        import { mock, test } from "bun:test";
        mock.module(${JSON.stringify(path)}, () => (${mock}));
        test(${JSON.stringify(name)}, async () => {
          const { read } = await import("./reader");
          console.log(${JSON.stringify(name)}, read());
        });`,
    })),
  );
});
