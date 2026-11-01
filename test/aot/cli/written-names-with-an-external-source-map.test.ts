// docs/compiler/debugging.mdx, "Minified executables and external source maps": with --sourcemap=external the names of functions, classes,
// variables, parameters and imports are in the map and not in the executable. `name` is "", a frame has no name, and a message has a short
// name where the program wrote one. Keys, strings and descriptions of symbols, here the names that begin with "kept", may stay: the program
// finds and prints them when it runs.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, slot, spawned } from "../harness/commands";
import { describe, test } from "../supported";

const env = { ...bunEnv, NO_COLOR: "1" };
const buildLimit = 300_000;

const program = {
  "app.ts": `import "./ledger";
`,
  "ledger.ts": `import { ImportedClassN1, importedArrowN2 } from "./imported";

const given: any = JSON.parse(process.argv[2] ?? "{}");

function show(label: string, run: () => unknown) {
  try {
    console.log(label + ":", String(run()));
  } catch (error) {
    console.log(label + ":", (error as Error).message);
  }
}

export function readsImportsEarlyN3() {
  show("early imported arrow", () => importedArrowN2());
}

const reads: [string, () => unknown][] = [
  ["variable", () => new LateClassN5().keptMethodN6(lateVariableN7)],
  ["static class", () => StaticClassN8.keptStaticN9(1)],
  ["arrow", () => lateArrowN10()],
  ["class expression", () => typeof new LateHolderN11()],
  ["enum", () => LateEnumN12.keptMemberN13],
  ["imported class", () => new ImportedClassN1().keptTotalN4()],
  ["imported arrow", () => importedArrowN2()],
];
for (const [label, read] of reads) show("early " + label, read);

class LateClassN5 {
  keptMethodN6(parameterN14: number): number {
    if (parameterN14 < 0) throw new RangeError("keptTextN15 " + parameterN14);
    return parameterN14;
  }
}
let lateVariableN7 = 4;
class StaticClassN8 {
  static keptEntriesN16: number[] = [];
  static keptStaticN9(entryN17: number) {
    StaticClassN8.keptEntriesN16.push(entryN17);
    return StaticClassN8.keptEntriesN16.length;
  }
}
const lateArrowN10 = () => 5;
const LateHolderN11 = class OwnNameN18 {};
enum LateEnumN12 {
  keptMemberN13,
}
for (const [label, read] of reads) show("late " + label, read);

const firstFrame = (error: Error) => error.stack!.split("\\n")[1]!.trim().split(" ")[1];
function renamedFunctionN19() {
  return firstFrame(new Error("keptTextN20"));
}
(renamedFunctionN19 as any).displayName = "keptDisplayNameN21";
const keySymbolN22 = Symbol("keptDescriptionN23");
class KeyedClassN24 {
  [keySymbolN22]() {
    return firstFrame(new Error("keptTextN25"));
  }
  get [Symbol.for("keptRegisteredN26")]() {
    return firstFrame(new Error("keptTextN27"));
  }
  static ["keptComputed" + "N28"]() {
    return firstFrame(new Error("keptTextN29"));
  }
  [given.key ?? "keptGivenN30"]() {
    return firstFrame(new Error("keptTextN31"));
  }
}
function onlyComparedN32() {}
class RefusedErrorN33 extends Error {}
interface OnlyTypeN34 {
  keptTitleN35: string;
}
function readsTitleN36(recordN37: OnlyTypeN34) {
  return recordN37.keptTitleN35;
}
function callsParameterN38(parameterN39: any) {
  return parameterN39();
}
function holdsLocalsN40() {
  const readsLocalN41 = () => localVariableN42;
  if (!given.late) readsLocalN41();
  const localVariableN42 = 1;
  return readsLocalN41();
}
const unknownFunctionN43 = given.function;
const UnknownClassN44 = given.class;
const unknownHolderN45 = given.holder ?? {};
const UnknownKindN49 = given.kind ?? {};

show("frame of a function with a displayName", renamedFunctionN19);
show("frame of a method under a symbol", () => new KeyedClassN24()[keySymbolN22]());
show("frame of a getter under a registered symbol", () => (new KeyedClassN24() as any)[Symbol.for("keptRegisteredN26")]);
show("frame of a static method under a joined key", () => (KeyedClassN24 as any).keptComputedN28());
show("frame of a method under a given key", () => (new KeyedClassN24() as any).keptGivenN30());
show("names", () =>
  JSON.stringify([
    LateClassN5.name,
    StaticClassN8.name,
    lateArrowN10.name,
    LateHolderN11.name,
    renamedFunctionN19.name,
    KeyedClassN24.name,
    new KeyedClassN24()[keySymbolN22].name,
    onlyComparedN32.name,
    RefusedErrorN33.name,
  ]),
);
show("compared", () => given.function === onlyComparedN32);
show("error of a class of the program", () => new RefusedErrorN33("keptTextN46"));
show("member of a typed parameter", () => readsTitleN36({ keptTitleN35: "keptTextN47" }));
show("callee that is a parameter", () => callsParameterN38(given.function));
show("local variable", holdsLocalsN40);
show("callee that is a variable", () => unknownFunctionN43(1));
show("constructor that is a variable", () => new UnknownClassN44());
show("callee that is a member", () => unknownHolderN45.keptAbsentN48(2));
show("right side of instanceof", () => unknownHolderN45 instanceof UnknownKindN49);
`,
  "imported.ts": `import { readsImportsEarlyN3 } from "./ledger";

readsImportsEarlyN3();
export const importedArrowN2 = () => 6;
export class ImportedClassN1 {
  keptTotalN4() {
    return 7;
  }
}
`,
};

const sources = Object.values(program).join();
const everyName = [...new Set(sources.match(/\b[A-Za-z]+N\d+\b/g))];
// What a function under a symbol is called is made of the description, and is a name of a function all the same.
const written = [...everyName.filter(name => !name.startsWith("kept")), "[keptDescriptionN23]", "[keptRegisteredN26]"];

const short = "[A-Za-z_$][\\w$]{0,5}";
const deadZone = `Cannot access '${short}' before initialization\\.`;
const expected: [label: string, shown: string][] = [
  ["early imported arrow", deadZone],
  ["early variable", deadZone],
  ["early static class", deadZone],
  ["early arrow", deadZone],
  ["early class expression", deadZone],
  ["early enum", "0"],
  ["early imported class", "7"],
  ["early imported arrow", "6"],
  ["late variable", "4"],
  ["late static class", "1"],
  ["late arrow", "5"],
  ["late class expression", "object"],
  ["late enum", "0"],
  ["late imported class", "7"],
  ["late imported arrow", "6"],
  ["frame of a function with a displayName", "<anonymous>"],
  ["frame of a method under a symbol", "<anonymous>"],
  ["frame of a getter under a registered symbol", "<anonymous>"],
  ["frame of a static method under a joined key", "<anonymous>"],
  ["frame of a method under a given key", "<anonymous>"],
  ["names", '\\["","","","","","","","",""\\]'],
  ["compared", "false"],
  ["error of a class of the program", "Error: keptTextN46"],
  ["member of a typed parameter", "keptTextN47"],
  ["callee that is a parameter", `${short} is not a function\\..*`],
  ["local variable", deadZone],
  ["callee that is a variable", `${short} is not a function\\..*`],
  ["constructor that is a variable", `undefined is not a constructor \\(evaluating 'new ${short}'\\)`],
  ["callee that is a member", `${short}\\.keptAbsentN48 is not a function\\..*`],
  ["right side of instanceof", `${short} is not a function\\. \\(evaluating '${short} instanceof ${short}'\\)`],
];

interface SourceMap {
  names: string[];
  x_facebook_sources: [{ names: string[] }][];
}

describe.concurrent.each([
  ["--sourcemap=external", ["--sourcemap=external"]],
  ["--minify --sourcemap=external", ["--minify", "--sourcemap=external"]],
  ["--keep-names --sourcemap=external", ["--keep-names", "--sourcemap=external"]],
] as [string, string[]][])("written names, built with %s", (_, flags) => {
  test(
    "are in the map, and neither in the executable nor in what it prints",
    () =>
      slot(async () => {
        using dir = tempDir("aot-written-names-external-map", program);
        const folder = String(dir);
        built(await spawned([bunExe(), "compile", "app.ts", ...flags, "--outfile", "dist/app"], folder, env));
        const executable = join(folder, "dist", isWindows ? "app.exe" : "app");

        const file = readFileSync(executable);
        expect(written.filter(name => file.includes(name) || file.includes(Buffer.from(name, "utf16le")))).toEqual([]);

        const run = await spawned([executable], folder, env);
        expect({ stderr: run.stderr, exitCode: run.exitCode }).toEqual({ stderr: "", exitCode: 0 });
        expect(run.stdout.trimEnd().split("\n")).toEqual(
          expected.map(([label, shown]) => expect.stringMatching(new RegExp(`^${label}: ${shown}$`))),
        );

        const map: SourceMap = JSON.parse(readFileSync(executable + ".map", "utf8"));
        expect(map.names).toEqual(
          expect.arrayContaining(["renamedFunctionN19", "holdsLocalsN40", "readsImportsEarlyN3"]),
        );
        expect(map.x_facebook_sources.flatMap(([functions]) => functions.names)).toEqual(
          expect.arrayContaining(["LateClassN5", "StaticClassN8", "lateArrowN10", "OwnNameN18", "KeyedClassN24"]),
        );
      }),
    buildLimit,
  );
});
