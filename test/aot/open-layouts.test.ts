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
    const build = await spawned(
      [bunExe(), "build", "--compile", "--aot", "--aot-explain=foreign", "--outfile", "app", program],
      folder,
      bunEnv,
    );
    built(build);
    const compiled = await spawned([join(folder, "app")], folder, { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
    expect(compiled.signal).toBeNull();
    const plain = await spawned([bunExe(), "run", program], folder, bunEnv);
    expect({ signal: plain.signal, exitCode: plain.exitCode }).toEqual({ signal: null, exitCode: 0 });
    expect(told(compiled)).toEqual(told(plain));
    const open = (build.stdout + build.stderr)
      .split("\n")
      .flatMap(line => /^aot: foreign: ((?:typeof )?[A-Za-z]+):/.exec(line)?.[1] ?? []);
    return declared.filter(name => open.includes(name));
  }

  test(
    "`undefined!`, `null!` and `undefined as any` in the place of a record open no type",
    () =>
      slot(async () => {
        expect(await openAmong("placeholders-of-nil.ts", ["Holder", "Big", "Leaf"])).toEqual([]);
      }),
    600_000,
  );

  test(
    "data from outside in that place still opens the type",
    () =>
      slot(async () => {
        expect(await openAmong("data-replacing-placeholder.ts", ["Holder", "Big", "Leaf"])).toContain("Big");
      }),
    600_000,
  );

  test(
    "a union that is only written beside an open type opens none of its other arms",
    () =>
      slot(async () => {
        expect(await openAmong("union-next-to-open-type.ts", ["Settings", "Tree", "Twig", "Fruit"])).toEqual([
          "Settings",
        ]);
      }),
    600_000,
  );

  test(
    "data from outside that is held to a union opens all its arms, and each arm is found",
    () =>
      slot(async () => {
        expect(await openAmong("data-checked-against-union.ts", ["Settings", "Small", "Tree"])).toEqual([
          "Settings",
          "Small",
          "Tree",
        ]);
      }),
    600_000,
  );

  test(
    "a constructor function that is cast to a type with its own call signature opens no type",
    () =>
      slot(async () => {
        expect(await openAmong("constructor-function-cast-to-own-signatures.ts", ["State", "Task", "Request"])).toEqual(
          [],
        );
      }),
    600_000,
  );

  test(
    "a constructor function that leaves typed code takes what it is handed there",
    () =>
      slot(async () => {
        expect(await openAmong("constructor-function-escapes-typed-code.ts", ["State", "Request"])).toContain("State");
      }),
    600_000,
  );

  test(
    "a literal with accessors that has a layout opens no type it is handed on as",
    () =>
      slot(async () => {
        expect(await openAmong("accessor-literal-with-layout.ts", ["Factory", "Tools", "Sink"])).toEqual([]);
      }),
    600_000,
  );

  test(
    "a literal with accessors that is made as an ordinary object still opens the type",
    () =>
      slot(async () => {
        expect(await openAmong("plain-accessor-literal.ts", ["Factory"])).toEqual(["Factory"]);
      }),
    600_000,
  );

  test(
    "the object of a namespace block opens no type",
    () =>
      slot(async () => {
        expect(await openAmong("namespace-block-object.ts", ["typeof Debug", "typeof Inner"])).toEqual([]);
      }),
    600_000,
  );

  test(
    "a conditional type that compares an open type with another type opens only the first",
    () =>
      slot(async () => {
        expect(await openAmong("conditional-type-next-to-open-type.ts", ["Settings", "Totals"])).toEqual(["Settings"]);
      }),
    600_000,
  );

  test(
    "an assignment after a conditional type has compared the same two types opens both",
    () =>
      slot(async () => {
        expect(await openAmong("assignment-after-conditional-type.ts", ["Settings", "Totals"])).toEqual([
          "Settings",
          "Totals",
        ]);
      }),
    600_000,
  );

  test(
    "a look-alike that is held to the type of a namespace still opens it",
    () =>
      slot(async () => {
        expect(await openAmong("lookalike-checked-against-namespace-type.ts", ["typeof Debug"])).toEqual([
          "typeof Debug",
        ]);
      }),
    600_000,
  );
});
