// One compiler, one program, one set of flags: one executable, however the threads of the back end fall. Once a line of generated code followed a cache that
// those threads share: on a loaded machine eight builds of one program gave two or three executables. So the builds here run at once, each short of
// processors, over one entry point that imports some 120 stored programs. The tests beside this one ask the same of the threads that load the files.
import { expect } from "bun:test";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, spawned, withoutDebugInformation } from "./harness/commands";
import { afterAll } from "./harness/default-timeout";
import { compileCommand } from "./harness/flags";
import { runsWholeGrids } from "./harness/ways";
import { describe, test } from "./supported";

// Two or three executables came of eight builds: three builds tell it often, and a build takes twenty seconds of a processor. The benches make all eight.
const builds = runsWholeGrids ? 8 : 3;
const folder = join(import.meta.dir, "parallel", "classes");
// A list, so that a program that comes to the folder later cannot stop this build. One that has left the folder, or asks for flags by now, is left out.
const listed = `
a-decorated-field-under-a-symbol-hides-the-accessor-of-the-base-class.ts a-field-under-a-symbol-hides-the-accessor-of-the-base-class-in-a-loop.js
a-function-makes-a-class-below-one-with-several-possible-parents-and-another-below-that.js
a-function-makes-a-class-below-one-with-several-possible-parents-and-the-parent-changes.js
a-function-makes-a-class-below-one-with-several-possible-parents-called-through-a-variable.js
a-function-makes-a-class-below-one-with-several-possible-parents-each-taken-in-turn.js
a-function-makes-a-class-below-one-with-several-possible-parents-many-objects.js
a-function-makes-a-class-below-one-with-several-possible-parents-one-of-which-returns-another-object.js
a-function-makes-a-class-below-one-with-several-possible-parents-that-read-new-target.js
a-function-makes-a-class-below-one-with-several-possible-parents-that-share-a-root.js
a-function-makes-a-class-below-one-with-several-possible-parents-three-of-them.js a-function-makes-a-class-below-one-with-several-possible-parents.js
a-private-name-on-an-object-made-for-a-class-below-array.js a-store-to-a-private-field-that-text-gave-another-object-of-the-class.ts
a-store-to-a-private-field-that-the-object-was-never-given.js an-initializer-runs-twice-on-an-instance-of-its-own-class.js
bare-field-undefined-class-expression.js bare-field-undefined-instance-replaced.js bare-field-undefined-object-replaced.ts
bare-field-undefined-replaced-parent.js bare-field-undefined-replaced.js bare-private-field-undefined-replaced.js
base-constructor-makes-object-new-target.js class-constructed-for-subclass.js class-evaluated-again-definition-creates.js
class-from-arrow-constructed-with-other-new-target.mjs class-from-arrow-linked-above-earlier-function.mjs class-printed-display-name-holds-static.js
class-stored-where-object-with-its-static-members-was.js class-text-evaluated-many-times-parents.js class-without-name-is-default-export.mjs
classes-128-130-static-fields-listed.js classes-changed-where-compiler-not-look.ts classes-function-stores-variable-module.js
classes-of-factory-constructed-rotation.js classes-only-their-evaluation-defines-linked-above-earlier-functions.mjs
classes-without-static-member-name.js classes-written-for-es5-inherit-helper.js closure-kept-earlier-call-reads-constant.ts
computed-index-accessor-keys-across-evaluations.js constructor-calls-method-fields-defined.ts constructor-lets-object-fields-defined.js
constructor-stores-inherited-accessor.js declared-classes-function-called.js declared-functions-return-class-called.js
default-on-the-prototype-read-where-the-slot-is-empty.ts defaults-on-a-class-prototype.js definition-throws-leaves-fields-defined.js
derived-constructor-stores-through-base-setter.js evaluated-many-times-below-same-and-new-parents.js evaluated-text-lists-static-fields-first.js
evaluated-text-reads-name-classes.js every-method-class-more-methods-word.ts field-below-an-undeclared-base.js field-declared-without-value-class.js
field-declared-without-value-defined.js field-declared-without-value-read-ahead.js field-defined-object-may-not-grow-first.js
field-derived-constructor-evaluate-text.js field-initializers-called-and-not-taken.js fields-created-conditions-keep-order.ts
fields-declared-without-value-classes.js fields-declared-without-value-numbers.js fields-declared-without-value-stored.js
fields-declared-without-value-superclass.ts fields-defined-object-base-returns-first.js
first-print-of-an-instance-lists-symbol-methods-in-written-order.js function-constructs-without-end-classes.js
function-field-private-accessor-holds.ts function-makes-two-subclass-class.js index-accessors-in-class-bodies-and-typed-array-prototypes.js
instanceof-of-function-keeps-prototype.js lazy-fields-of-escaped-instances.js lists-every-length-spread-super-class.js
loop-reads-changed-inside-loop-naming.js members-are-found-by-name-several-classes-up.js members-assigned-to-a-class-prototype.js
members-defined-nobody-can-see-class.js members-found-rows-fourteen-sixteen.js members-of-base-change-heirs-defined.js
members-that-a-class-types-otherwise-than-its-base.ts method-name-looks-like-number-hidden.js methods-classes-private-members-compared.js
name-looks-like-negative-number-stored.js name-looks-like-number-stored-prototype.js names-builtins-as-data-called-as-methods.js
names-look-like-numbers-plain-names.js names-look-like-numbers-stored-prototype.js objects-elements-lie-prototypes-setters.js
objects-of-later-evaluations.js optional-number-fields-left-out.ts optional-number-fields-without-a-value.ts own-props-tests-under-names-of-members.js
private-field-read-again-behind-what-may-have-stored-it.js props-constructor-fn-read-first.js prototype-chains-changed-subclass.js
prototype-of-class-is-no-instance-of-it.ts several-members-of-base-change-heirs.js
several-possible-parents-a-property-added-below-a-mixin-over-itself.js several-possible-parents-a-property-assigned-below-a-mixin-over-itself.js
several-possible-parents-constructors-between-that-do-not-hand-on.js several-possible-parents-fields-of-root-between-and-leaf-in-order.js
several-possible-parents-links-changed-later.js several-possible-parents-names-of-the-root-declared-again-between.js
several-possible-parents-the-root-is-evaluated-twice.js several-possible-parents-without-a-shared-root-or-below-itself.js
static-field-replaces-static-method-loop.js static-field-union-number-literals-any.ts static-field-union-number-literals-cast.ts
static-fields-changed-evaluated-text.js static-fields-type-number-read-change.ts
stores-to-this-below-an-accessor-that-classes-between-hide-or-do-not.ts subclass-builtin-classes-first-touched.ts
subclass-no-constructor-constructed.js super-call-text-evaluated-constructor.js super-call.ts super-calls-a-method-that-does-nothing-that-shows.js
super-calls-follow-every-change-home.js super-finds-the-method-right-above-until-that-one-goes.js the-constructor-of-an-object-of-several-classes.ts
unread-field-stored-replaced-parent.js what-a-class-definition-shows.ts wide-base-constructed-from-subclass.js
`
  .trim()
  .split(/\s+/);
const asksForSomething = /^\/\/ (Flags|Env):|\/\* (Output|Build errors):|process\.exit|STATISTIC|COUNT/m;

describe("compile/aot/builds of one program at once make one executable", () => {
  const root = String(tempDir("aot-builds-at-once", {}));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test("builds at once", async () => {
    const programs = listed.filter(
      name => existsSync(join(folder, name)) && !asksForSomething.test(readFileSync(join(folder, name), "utf8")),
    );
    expect(programs.length).toBeGreaterThan(60);
    mkdirSync(join(root, "classes"));
    for (const name of programs) cpSync(join(folder, name), join(root, "classes", name));
    writeFileSync(join(root, "main.ts"), programs.map(name => `import "./classes/${name}";\n`).join(""));
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "esnext",
          module: "preserve",
          moduleDetection: "force",
          moduleResolution: "bundler",
          allowImportingTsExtensions: true,
          allowJs: true,
          noEmit: true,
          types: [],
        },
      }),
    );
    const hashes = await Promise.all(
      Array.from({ length: builds }, async (_, index) => {
        mkdirSync(join(root, String(index)));
        // One name for all: the executable may hold its own name.
        const executable = join(root, String(index), isWindows ? "program.exe" : "program");
        built(
          await spawned(
            [bunExe(), ...compileCommand, ...withoutDebugInformation(), join(root, "main.ts"), "--outfile", executable],
            root,
            bunEnv,
          ),
        );
        const hash = new Bun.CryptoHasher("sha256").update(readFileSync(executable)).digest("hex");
        rmSync(executable);
        return hash;
      }),
    );
    expect(new Set(hashes).size).toBe(1);
  }, 600_000);
});
