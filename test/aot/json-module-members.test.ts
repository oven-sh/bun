import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "path";
import { run as spawned } from "./harness/run";
import { describe, test } from "./supported";

const files = {
  "data.json": `{ "b": 1, "a": 2, "zeta": { "y": 1, "x": 2 } }`,
  "numbers.json": `{ "b": 1, "10": 2, "a": 3, "2": 4 }`,
  "dashes.json": `{ "a-b": "dash", "plain": 1, "with space": 2 }`,
  "re-export.mjs": `export { a as first, zeta } from "./data.json";\n`,
};

const programs: Record<string, string> = {
  "stored-to-before-the-namespace-is-held.mjs": `import whole from "./data.json";
import * as ns from "./data.json";
whole.a = 99; whole.added = 1; delete whole.b;
const held = ns;
console.log(held.a, ns.a, held.b, ns.b, held.added, Object.keys(held).join(), held.default === whole);
`,
  "stored-to-after-the-namespace-is-held.mjs": `import whole from "./data.json";
import * as ns from "./data.json";
const held = ns;
whole.a = 99;
console.log(held.a, ns.a, held.default.a);
`,
  "named-imports.mjs": `import whole, { a, zeta } from "./data.json";
whole.a = 99; whole.zeta = null;
console.log(a, whole.a, zeta.x, whole.zeta);
`,
  "named-imports-read-first.mjs": `import whole, { a, zeta } from "./data.json";
console.log(a, zeta === whole.zeta);
whole.a = 99;
console.log(a, whole.a);
`,
  "exported-again.mjs": `import whole from "./data.json";
import { first, zeta } from "./re-export.mjs";
whole.a = 99;
console.log(first, zeta === whole.zeta);
`,
  "imported-later.mjs": `import whole from "./data.json";
import * as ns from "./data.json";
whole.a = 99;
const late = await import("./data.json");
console.log(late.a, late.default.a, late === ns);
`,
  "typescript.ts": `import whole, { a } from "./data.json";
import * as ns from "./data.json";
(whole as { a: number }).a = 99;
const sum: number = a + ns.a;
console.log(sum, whole.a);
`,
  "names-that-are-no-identifiers.mjs": `import whole, { "a-b" as dashed, plain, "with space" as spaced } from "./dashes.json";
whole["a-b"] = "stored to";
console.log(dashed, plain, spaced);
`,
  "written-to.mjs": `import * as ns from "./data.json";
const held = ns;
try { held.a = 5; console.log("written", held.a); } catch (error) { console.log(error.name); }
try { delete held.a; console.log("deleted", held.a); } catch (error) { console.log(error.name); }
try { held.added = 5; console.log("added", held.added); } catch (error) { console.log(error.name); }
console.log(ns.a, Object.isFrozen(held), Object.isSealed(held), Object.isExtensible(held), String(held[Symbol.toStringTag]));
`,
  "descriptors.mjs": `import * as ns from "./data.json";
const held = ns;
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(held, "a")), JSON.stringify(Object.getOwnPropertyDescriptor(held, "default") !== undefined), Reflect.ownKeys(held).map(String).join());
`,
};

// The bundler exports only the keys that are identifiers.
const notInAnExecutable: Record<string, string> = {
  "keys-that-are-numbers.mjs": `import * as ns from "./numbers.json";
const held = ns;
console.log(Object.keys(held).join(), held[10], held["2"], 10 in held, 3 in held);
`,
};

const all = { ...programs, ...notInAnExecutable };

describe.concurrent.each(Object.keys(all))("%s", entry => {
  const tree = {
    ...files,
    [entry]: all[entry],
    "tsconfig.json": `{ "compilerOptions": { "resolveJsonModule": true, "module": "preserve", "moduleResolution": "bundler" } }`,
  };

  test("bun run --aot prints what bun run prints", async () => {
    using dir = tempDir("json-module-members", tree);
    const plain = await spawned([bunExe(), "run", entry], String(dir));
    const aot = await spawned([bunExe(), "run", "--debug-aot", entry], String(dir));
    expect(plain.exitCode).toBe(0);
    expect({ stdout: aot.stdout, exitCode: aot.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });

  test.skipIf(entry in notInAnExecutable)("bun build --compile --aot prints what bun run prints", async () => {
    using dir = tempDir("json-module-members", tree);
    const plain = await spawned([bunExe(), "run", entry], String(dir));
    const built = await spawned([bunExe(), "build", "--compile", "--aot", entry, "--outfile", "program"], String(dir));
    expect(built.stderr).not.toContain("error:");
    expect(built.exitCode).toBe(0);
    const aot = await spawned([join(String(dir), "program")], String(dir));
    expect(plain.exitCode).toBe(0);
    expect({ stdout: aot.stdout, exitCode: aot.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });
});
