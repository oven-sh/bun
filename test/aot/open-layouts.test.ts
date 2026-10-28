import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { openTypesFlags } from "./open-types";
import { built, slot, spawned, told, unsupported } from "./run-programs";

const tsconfig = JSON.parse(readFileSync(join(import.meta.dir, "programs", "tsconfig.json"), "utf8"));
tsconfig.compilerOptions.typeRoots = [join(import.meta.dir, "..", "..", "packages")];

const causeLine = /^aot: (unknown-code|unproven-type|mutation|limit): [a-z-]+ at /;

describe.skipIf(!!unsupported)("compile/aot/open-layouts", () => {
  const folders: string[] = [];
  afterAll(() => folders.forEach(folder => rmSync(folder, { recursive: true, force: true })));

  async function buildWithReport(program: string, flags: string[]) {
    const folder = String(tempDir("aot-open-layouts", {}));
    folders.push(folder);
    cpSync(join(import.meta.dir, "open-layouts", program), join(folder, program));
    writeFileSync(join(folder, "tsconfig.json"), JSON.stringify(tsconfig));
    const build = await spawned(
      [bunExe(), "build", "--compile", "--aot", ...flags, "--outfile", "app", program],
      folder,
      bunEnv,
    );
    built(build);
    return { folder, report: (build.stdout + build.stderr).split("\n") };
  }

  test.each([
    "placeholders-of-nil.ts",
    "data-replacing-placeholder.ts",
    "union-next-to-open-type.ts",
    "data-checked-against-union.ts",
    "constructor-function-cast-to-own-signatures.ts",
    "constructor-function-escapes-typed-code.ts",
    "accessor-literal-with-layout.ts",
    "plain-accessor-literal.ts",
    "namespace-block-object.ts",
    "conditional-type-next-to-open-type.ts",
    "assignment-after-conditional-type.ts",
    "namespace-type-lookalike.ts",
    "namespace-object-escapes.ts",
    "deleted-field.ts",
  ])(
    "%s prints what plain Bun prints",
    program =>
      slot(async () => {
        const { folder } = await buildWithReport(program, openTypesFlags);
        const compiled = await spawned([join(folder, "app")], folder, {
          ...bunEnv,
          BUN_JSC_crashIfInterpreterIsUsed: "1",
        });
        expect(compiled.signal).toBeNull();
        const plain = await spawned([bunExe(), "run", program], folder, bunEnv);
        expect({ signal: plain.signal, exitCode: plain.exitCode }).toEqual({ signal: null, exitCode: 0 });
        expect(told(compiled)).toEqual(told(plain));
      }),
    600_000,
  );

  // The report has one line for each cause, with its position and the types of the accesses that it costs. It does not list every type that a cause opens.
  test.todo("`undefined!`, `null!` and `undefined as any` stored in a record-typed field open no type");
  test.todo("parsed data stored in a record-typed field opens the type");
  test.todo("a union that parsed data never reaches stays closed");
  test.todo("parsed data checked against a union opens every member");
  test.todo("a constructor function that is cast to a type with its own call signature opens no type");
  test.todo("a constructor function that escapes to unknown code opens its parameter types");
  test.todo("an object literal with accessors that has a layout opens no type");
  test.todo("an object literal with accessors that is allocated as an ordinary object opens the type");
  test.todo("a namespace object opens no type");
  test.todo("a conditional type that compares an open type with another type opens only the first");
  test.todo("an assignment after a conditional type has compared the same two types opens both");
  test.todo("a look-alike annotated with the type of a namespace opens no type");
  test.todo("a namespace object that escapes to unknown code opens its type");
  test.todo("deleting a field lets no other object reach the type");

  test.each(["unknown-code", "unproven-type", "mutation"])(
    "--explain=%s lists only its own family",
    family =>
      slot(async () => {
        const { report } = await buildWithReport("deleted-field.ts", ["--explain=" + family]);
        expect(report.flatMap(line => causeLine.exec(line)?.[1] ?? []).filter(found => found !== family)).toEqual([]);
      }),
    600_000,
  );

  test(
    "--explain=mutation names the type whose field is deleted, and no other",
    () =>
      slot(async () => {
        const { report } = await buildWithReport("deleted-field.ts", ["--explain=mutation"]);
        expect(report.filter(line => causeLine.test(line))).toEqual([
          expect.stringMatching(
            /^aot: mutation: field-deleted at deleted-field\.ts:\d+:\d+, \d+ accesses, types 'Counter', /,
          ),
        ]);
      }),
    600_000,
  );
});
