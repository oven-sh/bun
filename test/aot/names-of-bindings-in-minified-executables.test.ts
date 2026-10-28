// `bun build --minify-identifiers` renames functions, classes, variables, parameters and imports. An executable built with --aot has no text to rename, and it shows such a name in `name`, in a stack trace and in a message:
// under the flag it shows a short one, and the executable does not hold what was written. Keys, strings, names of globals and what a direct eval can ask for stay. --keep-names keeps everything.
import { afterAll, expect } from "bun:test";
import { readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { buildFlags, compileCommand } from "./harness/flags";
import { built, spawned } from "./run-programs";
import { beforeAll, describe, test } from "./supported";

const sources = {
  "library.ts": `
export class DeclaredClassB1 {
  keptMethodB2(): string {
    return new Error("keptTextB3").stack!.split("\\n")[1].trim().split(" ")[1];
  }
}
export function declaredFunctionB4(parameterB5: any): unknown {
  return parameterB5();
}
export enum DeclaredEnumB6 {
  keptMemberB7 = 1,
}
`,
  "evaluates.ts": `
export function holdsEvalB15(seenByEvalB16: number): unknown {
  return eval("seenByEvalB" + "16 + 1");
}
`,
  "first.ts": `
export class TwinB18 {}
`,
  "second.ts": `
export class TwinB18 {}
`,
  "main.ts": `
import { holdsEvalB15 } from "./evaluates";
import { TwinB18 as FirstB19 } from "./first";
import { TwinB18 as SecondB20 } from "./second";
import { DeclaredClassB1, declaredFunctionB4 as importedFunctionB8, DeclaredEnumB6 } from "./library";
declare const freeNameB9: () => void;
function message(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return (error as Error).message;
  }
}
const arrowB10 = () => variableB11;
const expressionB12 = function ownNameB13() {};
const classExpressionB14 = class {};
console.log("function", importedFunctionB8.name);
console.log("class", DeclaredClassB1.name);
console.log("arrow", arrowB10.name);
console.log("expression", expressionB12.name);
console.log("class expression", classExpressionB14.name);
console.log("method", new DeclaredClassB1().keptMethodB2.name);
console.log("frame", new DeclaredClassB1().keptMethodB2());
console.log("callee", message(() => importedFunctionB8(undefined)));
console.log("dead zone", message(arrowB10));
console.log("free", message(() => freeNameB9()));
console.log("enum", Object.keys(DeclaredEnumB6).join());
console.log("eval", holdsEvalB15(1), holdsEvalB15.name);
const variableB11 = { keptKeyB17: 1 };
console.log("key", Object.keys(arrowB10()).join());
console.log("twins", FirstB19.name === SecondB20.name);
`,
};

const shortened = [
  "DeclaredClassB1",
  "declaredFunctionB4",
  "parameterB5",
  "DeclaredEnumB6",
  "importedFunctionB8",
  "arrowB10",
  "variableB11",
  "expressionB12",
  "ownNameB13",
  "classExpressionB14",
  "TwinB18",
  "FirstB19",
  "SecondB20",
];
const neverShown = ["importedFunctionB8", "expressionB12", "FirstB19", "SecondB20"];
const kept = [
  "keptMethodB2",
  "keptTextB3",
  "keptMemberB7",
  "freeNameB9",
  "holdsEvalB15",
  "seenByEvalB16",
  "keptKeyB17",
];

describe.each([
  ["by default", [], false],
  ["with --minify-identifiers", ["--minify-identifiers"], true],
  ["with --minify", ["--minify"], true],
  ["with --minify --keep-names", ["--minify", "--keep-names"], false],
] as [string, string[], boolean][])("compile/aot/names of bindings, built %s", (_, flags, shortens) => {
  const folder = String(tempDir("aot-names-of-bindings", sources));
  const executable = join(folder, isWindows ? "program.exe" : "program");
  let bytes = Buffer.alloc(0);
  let printed: Record<string, string> = {};
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  beforeAll(async () => {
    const command = [bunExe(), ...compileCommand, buildFlags.withoutFunctionSource, ...flags];
    built(await spawned([...command, "./main.ts", "--outfile", executable], folder, bunEnv));
    bytes = readFileSync(executable);
    const run = await spawned([executable], folder, bunEnv);
    expect({ stderr: run.stderr, exitCode: run.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    printed = {};
    for (const line of run.stdout.trimEnd().split("\n")) {
      const label = Object.keys(expected).find(label => line.startsWith(label + " "))!;
      printed[label] = line.slice(label.length + 1);
    }
  }, 300_000);

  const name = (written: string) => (shortens ? expect.stringMatching(/^[A-Za-z_$][\w$]{0,5}$/) : written);
  const within = (before: string, written: string, after: string) =>
    expect.stringMatching(new RegExp("^" + before + (shortens ? "[A-Za-z_$][\\w$]{0,5}" : written) + after));
  const expected: Record<string, unknown> = {
    "class expression": name("classExpressionB14"),
    "function": name("declaredFunctionB4"),
    "class": name("DeclaredClassB1"),
    "arrow": name("arrowB10"),
    "expression": name("ownNameB13"),
    "method": "keptMethodB2",
    "frame": "keptMethodB2",
    "callee": within("", "parameterB5", " is not a function"),
    "dead zone": within("Cannot access '", "variableB11", "' before initialization"),
    "free": expect.stringContaining("freeNameB9"),
    "enum": "1,keptMemberB7",
    "eval": "2 holdsEvalB15",
    "key": "keptKeyB17",
    "twins": String(!shortens),
  };

  test("the program shows the names", () => {
    expect(printed).toEqual(expected);
  });

  const found = (texts: string[]) => texts.filter(text => bytes.includes(text, 0, "latin1"));

  test("the executable holds keys, strings, names of globals and what a direct eval finds", () => {
    expect(found(kept)).toEqual(kept);
  });

  test("the executable holds the names of bindings only as long as they are shown as written", () => {
    expect(found(shortened)).toEqual(shortens ? [] : shortened.filter(name => !neverShown.includes(name)));
  });
});
