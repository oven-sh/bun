import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "path";
import { run as spawned } from "./harness/run";
import { describe, test } from "./supported";

async function run(flags: string[], cwd: string, entry: string) {
  return spawned([bunExe(), "run", ...flags, entry], cwd);
}

async function compiled(flags: string[], cwd: string, entry: string) {
  const program = "program" + flags.join("");
  const built = await spawned([bunExe(), "build", "--compile", ...flags, entry, "--outfile", program], cwd);
  expect(built.stderr).not.toContain("error:");
  expect(built.exitCode).toBe(0);
  return spawned([join(cwd, program)], cwd);
}

const files = {
  "data.json": `{ "b": 1, "a": 2, "zeta": { "y": 1, "x": 2 } }`,
  "odd.json": `{ "b": 1, "class": 2, "a-b": 3, "$x": 4, "é": 5, "default": 6, "_u": 7, "A": 8, "": 9, "a b": 10, "then": 12 }`,
  "list.json": `[1, 2, 3]`,
  "text.json": `"text"`,
  "null.json": `null`,
  "re-export.mjs": `export * from "./data.json";\nexport const own = 1;\n`,
};

const programs: Record<string, string> = {
  "keys.mjs": `import * as ns from "./data.json";
import whole from "./data.json";
const held = ns;
console.log(Object.keys(held).join(), "|", Object.keys(whole).join(), "|", Object.getOwnPropertyNames(held).join(), "|", held.default === whole);
for (const key in held) console.log("in", key);
console.log(JSON.stringify(held), JSON.stringify({ ...held }));
`,
  "members.mjs": `import * as ns from "./data.json";
import { a, zeta } from "./data.json";
const held = ns;
console.log(ns.a, ns.b, held.a, held.b, a, zeta === ns.zeta, zeta === held.zeta, zeta === ns.default.zeta, "a" in held, "missing" in held, held.missing);
`,
  "odd-keys.mjs": `import * as ns from "./odd.json";
const held = ns;
console.log(Object.keys(held).join("|"), typeof held.default, held.class, held.$x, held["a-b"], held[""]);
`,
  "not-an-object.mjs": `import * as list from "./list.json";
import * as text from "./text.json";
import * as nothing from "./null.json";
const show = ns => console.log(Object.keys(ns).filter(key => key !== "__esModule").join("|"), JSON.stringify(ns.default));
show(list); show(text); show(nothing);
`,
  "dynamic.mjs": `const held = await import("./data.json");
console.log(Object.keys(held).join(), "|", Object.keys(held.default).join(), "|", JSON.stringify(held));
`,
  "typescript.ts": `import * as ns from "./data.json";
const held: Record<string, unknown> = ns;
console.log(Object.keys(held).join(), ns.a + ns.b, ns.zeta.x);
`,
  "re-exported.mjs": `import * as lib from "./re-export.mjs";
const held = lib;
console.log(Object.keys(held).join(), held.a, held.own);
`,
};

describe.concurrent.each(Object.keys(programs))("%s", entry => {
  const tree = {
    ...files,
    [entry]: programs[entry],
    "tsconfig.json": `{ "compilerOptions": { "resolveJsonModule": true, "module": "preserve", "moduleResolution": "bundler" } }`,
  };

  test("bun run --aot prints what bun run prints", async () => {
    using dir = tempDir("json-namespace-keys", tree);
    const [plain, aot] = [await run([], String(dir), entry), await run(["--debug-aot"], String(dir), entry)];
    expect(plain.exitCode).toBe(0);
    expect({ stdout: aot.stdout, exitCode: aot.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });

  test("bun build --compile --aot prints what bun run prints", async () => {
    using dir = tempDir("json-namespace-keys", tree);
    const plain = await run([], String(dir), entry);
    const aot = await compiled(["--aot"], String(dir), entry);
    expect(plain.exitCode).toBe(0);
    expect({ stdout: aot.stdout, exitCode: aot.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });
});

test("the keys are sorted", async () => {
  using dir = tempDir("json-namespace-keys", { ...files, "keys.mjs": programs["keys.mjs"] });
  const { stdout } = await compiled(["--aot"], String(dir), "keys.mjs");
  expect(stdout.split("\n")[0]).toBe("a,b,default,zeta | b,a,zeta | a,b,default,zeta | true");
});
