import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, rmSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, told, unsupported } from "./run-programs";

describe.skipIf(!!unsupported)("compile/aot/open-layouts", () => {
  const folders: string[] = [];
  afterAll(() => folders.forEach(folder => rmSync(folder, { recursive: true, force: true })));

  async function openAmong(program: string, declared: string[]) {
    const folder = String(tempDir("aot-open-layouts", {}));
    folders.push(folder);
    cpSync(join(import.meta.dir, "open-layouts", program), join(folder, program));
    cpSync(join(import.meta.dir, "programs", "tsconfig.json"), join(folder, "tsconfig.json"));
    const build = await spawned([bunExe(), "build", "--compile", "--aot", "--aot-explain=foreign", "--outfile", "app", program], folder, bunEnv);
    built(build);
    const compiled = await spawned([join(folder, "app")], folder, { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
    expect(compiled.signal).toBeNull();
    const plain = await spawned([bunExe(), "run", program], folder, bunEnv);
    expect({ signal: plain.signal, exitCode: plain.exitCode }).toEqual({ signal: null, exitCode: 0 });
    expect(told(compiled)).toEqual(told(plain));
    const open = (build.stdout + build.stderr).split("\n").flatMap(line => /^aot: foreign: ([A-Za-z]+):/.exec(line)?.[1] ?? []);
    return declared.filter(name => open.includes(name));
  }

  test("`undefined!`, `null!` and `undefined as any` in the place of a record open no type", () =>
    slot(async () => {
      expect(await openAmong("placeholders-of-nil.ts", ["Holder", "Big", "Leaf"])).toEqual([]);
    }), 600_000);

  test("data from outside in that place still opens the type", () =>
    slot(async () => {
      expect(await openAmong("data-in-the-place-of-a-placeholder.ts", ["Holder", "Big", "Leaf"])).toContain("Big");
    }), 600_000);

  test("a union that is only written beside an open type opens none of its other arms", () =>
    slot(async () => {
      expect(await openAmong("a-union-written-beside-an-open-type.ts", ["Settings", "Tree", "Twig", "Fruit"])).toEqual(["Settings"]);
    }), 600_000);

  test("data from outside that is held to a union opens all its arms, and each arm is found", () =>
    slot(async () => {
      expect(await openAmong("data-held-to-a-union.ts", ["Settings", "Small", "Tree"])).toEqual(["Settings", "Small", "Tree"]);
    }), 600_000);

  test("a constructor function that is cast to a type with its own call signature opens no type", () =>
    slot(async () => {
      expect(await openAmong("a-constructor-function-cast-to-its-own-signatures.ts", ["State", "Task", "Request"])).toEqual([]);
    }), 600_000);

  test("a constructor function that leaves typed code takes what it is handed there", () =>
    slot(async () => {
      expect(await openAmong("a-constructor-function-that-leaves-typed-code.ts", ["State", "Request"])).toContain("State");
    }), 600_000);
});
