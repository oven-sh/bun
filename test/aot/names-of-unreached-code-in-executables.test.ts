// Code that nothing reaches leaves nothing in an executable built with --aot: no machine code, no string, and no name either.
// A frame of a stack trace and the `name` of a closure show the name of a function, so the executable holds the names of the functions
// that have code in it, inlined code too, and of no others.
import { afterAll, expect } from "bun:test";
import { readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { buildFlags, compileCommand } from "./harness/flags";
import { built, spawned } from "./run-programs";
import { beforeAll, describe, eachRow, gap, test } from "./supported";

// No name is part of another one: the executable stores a text that is part of another text only once.
const branch = (kind: string, condition: string) => `
function ${kind}HelperQ1(): string {
  return "${kind}HelperTextQ2";
}
function ${kind}CalleeQ3(${kind}ParameterQ4: Record<string, unknown>): unknown {
  const ${kind}LocalQ5 = ${kind}ParameterQ4.${kind}ReadByCalleeQ6;
  ${kind}ParameterQ4.${kind}WrittenByCalleeQ7 = "${kind}CalleeTextQ8";
  return [
    ${kind}LocalQ5,
    ${kind}HelperQ1(),
    { ${kind}KeyInCalleeQ94: 1 },
    { ${kind}TableInCalleeQ95: { ${kind}InnerOfTableQ96: [1, 2, 3], second: "two" }, third: { a: 1, b: 2, c: 3, d: 4 } },
  ];
}
function ${kind}KeptAroundQ9(bag: Record<string, unknown>): number {
  if (${condition}) {
    const ${kind}InBranchQ10 = bag.${kind}ReadInBranchQ11;
    bag.${kind}WrittenInBranchQ12 = "${kind}BranchTextQ13";
    function ${kind}NestedQ14(): unknown {
      return ${kind}InBranchQ10;
    }
    const ${kind}ArrowQ15 = () => ${kind}NestedQ14();
    class ${kind}ClassQ16 {
      ${kind}FieldQ17 = 1;
      ${kind}MethodQ18(): unknown {
        return ${kind}ArrowQ15();
      }
    }
    console.log(${kind}CalleeQ3(bag), new ${kind}ClassQ16().${kind}MethodQ18(), { ${kind}LiteralKeyQ19: 1 }, /${kind}PatternQ20/);
  }
  return 1;
}
`;

const functionsOfBranch = ["HelperQ1", "CalleeQ3", "NestedQ14", "ArrowQ15"];
const textsOfBranch = ["HelperTextQ2", "CalleeTextQ8", "BranchTextQ13", "PatternQ20"];
const variablesOfBranch = ["ParameterQ4", "LocalQ5", "InBranchQ10"];
const propertiesReadInBranch = ["ReadByCalleeQ6", "ReadInBranchQ11"];
const propertiesAddedInBranch = ["WrittenByCalleeQ7", "WrittenInBranchQ12"];
const propertiesOfObjectsMadeInBranch = ["FieldQ17", "MethodQ18", "LiteralKeyQ19", "KeyInCalleeQ94"];
const propertiesOfConstantObjectsInBranch = ["TableInCalleeQ95", "InnerOfTableQ96"];
const of = (kind: string, names: string[]) => names.map(name => kind + name);

const sources = {
  "flags.ts": `export const importedConstantFlagQ21 = false;\n`,
  "library.ts": `
export function keptExportQ22(value: number): number {
  return value + 1;
}
export function unusedExportQ23(): string {
  return "unusedExportTextQ24";
}
export function unusedImportQ25(): string {
  return "unusedImportTextQ26";
}
export enum UnusedEnumQ27 {
  unusedEnumMemberQ28 = "unusedEnumTextQ29",
}
export interface OnlyATypeQ30 {
  memberOfOnlyATypeQ31: number;
}
export class KeptClassQ32 {
  keptFieldQ33 = 1;
  keptMethodQ34(): number {
    return this.keptFieldQ33 + 2;
  }
  #unusedPrivateMethodQ35(): string {
    return "unusedPrivateMethodTextQ36";
  }
}
export class UnusedClassQ37 {
  unusedClassFieldQ38 = "unusedClassTextQ39";
  unusedClassMethodQ40(): string {
    return this.unusedClassFieldQ38;
  }
}
`,
  "module-for-unreached-code-q41.ts": `
export function calledByUnreachedCodeQ42(): string {
  return helperInModuleForUnreachedCodeQ43();
}
function helperInModuleForUnreachedCodeQ43(): string {
  return "moduleForUnreachedCodeTextQ44";
}
`,
  "module-imported-by-unreached-code-q45.ts": `
export function importedByUnreachedCodeQ46(): string {
  return "importedByUnreachedCodeTextQ47";
}
`,
  "module-without-effects-q48.ts": `
function inModuleWithoutEffectsQ49(): string {
  return "moduleWithoutEffectsTextQ50";
}
export const exportOfModuleWithoutEffectsQ51 = inModuleWithoutEffectsQ49;
`,
  "main.ts": `
import { importedConstantFlagQ21 } from "./flags";
import { keptExportQ22, unusedImportQ25, KeptClassQ32 } from "./library";
import type { OnlyATypeQ30 } from "./library";
import { calledByUnreachedCodeQ42 } from "./module-for-unreached-code-q41";
import "./module-without-effects-q48";

declare const DEFINED_FLAG_Q52: boolean;
${branch("literalFalse", "false")}
${branch("defined", "DEFINED_FLAG_Q52")}
${branch("importedConstant", "importedConstantFlagQ21")}
function typeTestCalleeQ53(): string {
  return "typeTestCalleeTextQ54";
}
function keptAroundTypeTestQ55(value: number): number {
  if (typeof value === "string") console.log(typeTestCalleeQ53(), "typeTestTextQ56");
  return value;
}
function afterReturnCalleeQ57(): string {
  return "afterReturnCalleeTextQ58";
}
function keptAroundReturnQ59(): number {
  return 1;
  console.log(afterReturnCalleeQ57());
}
function shortCircuitCalleeQ60(): string {
  return "shortCircuitCalleeTextQ61";
}
function conditionalCalleeQ62(): string {
  return "conditionalCalleeTextQ63";
}
function keptAroundOperatorsQ64(): number {
  false && console.log(shortCircuitCalleeQ60());
  return true ? 1 : Number(conditionalCalleeQ62());
}
function keptAroundModulesQ65(): number {
  if (false) {
    console.log(calledByUnreachedCodeQ42());
    import("./module-imported-by-unreached-code-q45").then(console.log);
  }
  return 1;
}
function helperOfUnusedFunctionQ66(): string {
  return "helperOfUnusedFunctionTextQ67";
}
function unusedFunctionQ68(unusedFunctionParameterQ69: Record<string, unknown>): unknown {
  unusedFunctionParameterQ69.writtenByUnusedFunctionQ70 = "unusedFunctionTextQ71";
  return [unusedFunctionParameterQ69.readByUnusedFunctionQ72, helperOfUnusedFunctionQ66()];
}
const unusedArrowQ73 = () => "unusedArrowTextQ74";
function keptWithUnusedLocalsQ75(value: number, unusedParameterQ76: number): number {
  const unusedLocalQ77 = "unusedLocalTextQ78";
  function unusedLocalFunctionQ79(): string {
    return "unusedLocalFunctionTextQ80";
  }
  return value * 2;
}
function keptThrowerQ81(): never {
  throw new Error("keptMessageQ82");
}
function keptButNeverCalledQ83(): string {
  return "keptButNeverCalledTextQ84";
}
interface NeverMadeHereQ86 {
  keptMemberQ87: number;
  memberThatNothingTouchesQ88?: string;
}
function keptReaderQ89(value: NeverMadeHereQ86): number {
  return value.keptMemberQ87;
}

const bag: Record<string, unknown> = { keptPropertyQ85: 1 };
const functions: Record<string, Function> = { keptButNeverCalledQ83, bound: keptExportQ22.bind(null) };
let stack = "";
try {
  keptThrowerQ81();
} catch (error) {
  stack = String((error as Error).stack).split("\\n")[1]!.trim().split(" ").slice(0, 2).join(" ");
}
const kept = new KeptClassQ32();
const fromOutside: any = JSON.parse('{"keptMemberQ87":1}');
console.log(
  literalFalseKeptAroundQ9(bag) +
    definedKeptAroundQ9(bag) +
    importedConstantKeptAroundQ9(bag) +
    keptAroundTypeTestQ55(1) +
    keptAroundReturnQ59() +
    keptAroundOperatorsQ64() +
    keptAroundModulesQ65() +
    keptWithUnusedLocalsQ75(1, 2) +
    keptExportQ22(1) +
    kept.keptMethodQ34() +
    keptReaderQ89(fromOutside),
);
console.log(Object.keys(bag).join(), stack);
console.log(Object.keys(functions).map(key => functions[key]!.name).join(), kept.constructor.name, keptExportQ22.name);
`,
};

const printed = `15
keptPropertyQ85 at keptThrowerQ81
keptButNeverCalledQ83,bound keptExportQ22 KeptClassQ32 keptExportQ22
`;

const namesOfKeptFunctionsAndTypes = [
  "keptThrowerQ81",
  "keptReaderQ89",
  "keptExportQ22",
  "KeptClassQ32",
  "NeverMadeHereQ86",
];

const builds = {
  "by default": [],
  "without the source of functions": [buildFlags.withoutFunctionSource],
} as const;

describe.each(Object.keys(builds) as (keyof typeof builds)[])(
  "compile/aot/names of unreached code, built %s",
  build => {
    const folder = String(tempDir("aot-names-of-unreached-code", sources));
    const executable = join(folder, isWindows ? "program.exe" : "program");
    let bytes = Buffer.alloc(0);
    afterAll(() => rmSync(folder, { recursive: true, force: true }));

    beforeAll(async () => {
      const flags = ["--define", "DEFINED_FLAG_Q52=false", ...builds[build]];
      built(
        await spawned([bunExe(), ...compileCommand, ...flags, "./main.ts", "--outfile", executable], folder, bunEnv),
      );
      bytes = readFileSync(executable);
    }, 300_000);

    const found = (names: string[]) =>
      names.filter(name => bytes.includes(name, 0, "latin1") || bytes.includes(name, 0, "utf16le"));

    test("the program prints the names of what it keeps", async () => {
      const run = await spawned([executable], folder, bunEnv);
      expect({ stdout: run.stdout, stderr: run.stderr, exitCode: run.exitCode }).toEqual({
        stdout: printed,
        stderr: "",
        exitCode: 0,
      });
    });

    test("the executable holds the names that the program can print", () => {
      const names = [
        "keptThrowerQ81",
        "keptButNeverCalledQ83",
        "keptExportQ22",
        "KeptClassQ32",
        "keptPropertyQ85",
        "keptMessageQ82",
      ];
      expect(found(names)).toEqual(names);
    });

    const foldedByTheParser = ["literalFalse", "defined"];
    eachRow([
      [
        "functions called in a branch that is `if (false)` or that --define folds",
        foldedByTheParser.flatMap(kind => of(kind, functionsOfBranch)),
      ],
      [
        "strings, variables and properties of such a branch",
        foldedByTheParser.flatMap(kind =>
          of(kind, [
            ...textsOfBranch,
            ...variablesOfBranch,
            ...propertiesReadInBranch,
            ...propertiesAddedInBranch,
            ...propertiesOfObjectsMadeInBranch,
            ...propertiesOfConstantObjectsInBranch,
            "ClassQ16",
          ]),
        ),
      ],
      [
        "functions called in a branch that a constant of another module folds",
        of("importedConstant", functionsOfBranch),
      ],
      [
        "strings and variables of such a branch, and the properties it reads",
        of("importedConstant", [...textsOfBranch, ...variablesOfBranch, ...propertiesReadInBranch]),
      ],
      [
        "the class of such a branch, and the properties of the objects it makes",
        of("importedConstant", [...propertiesOfObjectsMadeInBranch, "ClassQ16"]),
      ],
      [
        "the properties of the constant objects of a function that only such a branch calls",
        of("importedConstant", propertiesOfConstantObjectsInBranch),
      ],
      gap(
        "an object that the program does make has a place for every property that the program as written adds to it",
        [
          "the properties that such a branch adds to an object from outside it",
          of("importedConstant", propertiesAddedInBranch),
        ],
      ),
      [
        "a function called where a type rules the branch out",
        ["typeTestCalleeQ53", "typeTestCalleeTextQ54", "typeTestTextQ56"],
      ],
      [
        "functions called behind `return`, `false &&` and `true ? .. :`",
        [
          "afterReturnCalleeQ57",
          "afterReturnCalleeTextQ58",
          "shortCircuitCalleeQ60",
          "shortCircuitCalleeTextQ61",
          "conditionalCalleeQ62",
          "conditionalCalleeTextQ63",
        ],
      ],
      [
        "a function that nothing calls, and what it alone names",
        [
          "unusedFunctionQ68",
          "unusedFunctionParameterQ69",
          "writtenByUnusedFunctionQ70",
          "unusedFunctionTextQ71",
          "readByUnusedFunctionQ72",
          "helperOfUnusedFunctionQ66",
          "helperOfUnusedFunctionTextQ67",
          "unusedArrowQ73",
          "unusedArrowTextQ74",
        ],
      ],
      [
        "locals and parameters that nothing reads",
        [
          "unusedParameterQ76",
          "unusedLocalQ77",
          "unusedLocalTextQ78",
          "unusedLocalFunctionQ79",
          "unusedLocalFunctionTextQ80",
        ],
      ],
      [
        "exports and imports that nothing uses",
        ["unusedExportQ23", "unusedExportTextQ24", "unusedImportQ25", "unusedImportTextQ26"],
      ],
      [
        "an enum, a class and a type that nothing uses",
        [
          "UnusedEnumQ27",
          "unusedEnumMemberQ28",
          "unusedEnumTextQ29",
          "OnlyATypeQ30",
          "memberOfOnlyATypeQ31",
          "UnusedClassQ37",
          "unusedClassFieldQ38",
          "unusedClassTextQ39",
          "unusedClassMethodQ40",
        ],
      ],
      [
        "a member that nothing touches, of a type of which the program makes no object",
        ["memberThatNothingTouchesQ88"],
      ],
      [
        "what is in a module that only unreached code uses",
        [
          "calledByUnreachedCodeQ42",
          "helperInModuleForUnreachedCodeQ43",
          "moduleForUnreachedCodeTextQ44",
          "importedByUnreachedCodeQ46",
          "importedByUnreachedCodeTextQ47",
          "module-imported-by-unreached-code-q45",
          "inModuleWithoutEffectsQ49",
          "moduleWithoutEffectsTextQ50",
          "exportOfModuleWithoutEffectsQ51",
        ],
      ],
      gap("every module that is imported has a row in the table of modules", [
        "the file names of modules of which no code is left",
        ["module-for-unreached-code-q41", "module-without-effects-q48"],
      ]),
    ] as [string, string[]][])("the executable does not hold %s", (_, names) => {
      expect(found(names)).toEqual([]);
    });

    // The source of a class is kept whole for toString().
    test.skipIf(build === "by default")("the executable does not hold a private method that nothing calls", () => {
      expect(found(["unusedPrivateMethodQ35", "unusedPrivateMethodTextQ36"])).toEqual([]);
    });
  },
);

describe("compile/aot/names of unreached code, obfuscated", () => {
  const folder = String(tempDir("aot-names-in-an-obfuscated-executable", sources));
  const executable = join(folder, isWindows ? "program.exe" : "program");
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  test("the executable holds no name of a function, a class or a type, and every name of a property", async () => {
    const flags = ["--define", "DEFINED_FLAG_Q52=false", buildFlags.obfuscate];
    built(await spawned([bunExe(), ...compileCommand, ...flags, "./main.ts", "--outfile", executable], folder, bunEnv));
    const bytes = readFileSync(executable);
    const found = (names: string[]) =>
      names.filter(name => bytes.includes(name, 0, "latin1") || bytes.includes(name, 0, "utf16le"));
    expect(found(namesOfKeptFunctionsAndTypes)).toEqual([]);
    expect(found(["keptPropertyQ85", "keptMethodQ34", "keptMemberQ87"])).toEqual([
      "keptPropertyQ85",
      "keptMethodQ34",
      "keptMemberQ87",
    ]);
    const run = await spawned([executable], folder, bunEnv);
    expect({ firstLine: run.stdout.split("\n")[0], stderr: run.stderr, exitCode: run.exitCode }).toEqual({
      firstLine: "15",
      stderr: "",
      exitCode: 0,
    });
  }, 300_000);
});
