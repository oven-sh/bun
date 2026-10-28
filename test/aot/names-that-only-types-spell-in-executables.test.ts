// Types are erased from a program. A name or a text that only a type spells leaves nothing in an executable built with --aot,
// unless something outside the program can bring it in and the executable has to know it then.
import { afterAll, expect } from "bun:test";
import { readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { buildFlags, compileCommand } from "./harness/flags";
import { built, spawned } from "./run-programs";
import { beforeAll, describe, eachRow, test } from "./supported";

// No name is part of another one: the executable stores a text that is part of another text only once.
const sources = {
  "types.ts": `
export interface SettingsT1 {
  storedT2: number;
  neverStoredT3?: string;
  neverStoredObjectT4?: { innerOfNeverStoredT5: number };
}
export type KeysT25 = Record<"neverStoredKeyT7" | "otherNeverStoredKeyT8", number>;
export type TableT6 = Partial<KeysT25>;
export type MappedT9 = { [Key in "neverStoredMappedT10" | "otherNeverStoredMappedT11"]?: number };
export interface ParsedT12 {
  readT13: number;
  neverReadT14?: string;
}
export type ModeT15 = "madeT16" | "neverMadeT17" | "otherNeverMadeT18";
export type GivenT19 = "comparedT20" | "givenT21";
export interface ReachedT22 {
  storedT23: number;
  neverNamedT24?: string;
}
export interface HandedOnT38 {
  modeT37: ModeT15;
  neverStoredModeT39?: ModeT15;
  neverStoredTextT40?: string;
}
export const enum LevelT32 {
  usedLevelT33 = "usedLevelTextT34",
  unusedLevelT35 = "unusedLevelTextT36",
}
`,
  "main.ts": `
import { LevelT32 } from "./types";
import type { GivenT19, HandedOnT38, MappedT9, ModeT15, ParsedT12, ReachedT22, SettingsT1, TableT6 } from "./types";
function makeSettings(stored: number): SettingsT1 {
  return { storedT2: stored };
}
function makeMode(): ModeT15 {
  return "madeT16";
}
function describeMode(mode: ModeT15): string {
  return "mode " + mode;
}
function isCompared(given: GivenT19): boolean {
  return given === "comparedT20";
}
const nameFromOutside = process.argv[2];
const settings = makeSettings(1);
const table: TableT6 = {};
const mapped: MappedT9 = {};
console.log(Object.keys(settings).join(), Object.keys(table).length, Object.keys(mapped).length, nameFromOutside in settings);
const reached: ReachedT22 = { storedT23: 1 };
const byAnyName = reached as unknown as Record<string, unknown>;
console.log(byAnyName[nameFromOutside]);
byAnyName[nameFromOutside] = 2;
console.log(byAnyName[nameFromOutside], Object.keys(reached).join(), JSON.stringify(reached));
const parsed = JSON.parse(process.argv[3]) as ParsedT12;
console.log(parsed.readT13, Object.keys(parsed).join(), JSON.stringify(parsed));
console.log(describeMode(makeMode()), isCompared(process.argv[4] as GivenT19), LevelT32.usedLevelT33);
`,
};

const spell = (...parts: string[]) => parts.join("");

const namesOfTypes = [
  "SettingsT1",
  "TableT6",
  "MappedT9",
  "ParsedT12",
  "ModeT15",
  "GivenT19",
  "ReachedT22",
  "KeysT25",
  "HandedOnT38",
];

const evaluatesText = `
const handedOn: HandedOnT38 = { modeT37: makeMode() };
console.log(new Function("handedOn", process.argv[5])(handedOn));
`;

describe.each([
  ["by default", [], ""],
  ["with --minify-identifiers", ["--minify-identifiers"], ""],
  ["by default, where the program hands an object to text that it evaluates", [], evaluatesText],
] as [string, string[], string][])("compile/aot/names that only types spell, built %s", (_, flagsOfBuild, more) => {
  const folder = String(
    tempDir("aot-names-that-only-types-spell", { ...sources, "main.ts": sources["main.ts"] + more }),
  );
  const executable = join(folder, isWindows ? "program.exe" : "program");
  let bytes = Buffer.alloc(0);
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  beforeAll(async () => {
    const flags = [buildFlags.withoutFunctionSource, ...flagsOfBuild];
    built(await spawned([bunExe(), ...compileCommand, ...flags, "./main.ts", "--outfile", executable], folder, bunEnv));
    bytes = readFileSync(executable);
  }, 300_000);

  const found = (names: string[]) =>
    names.filter(name => bytes.includes(name, 0, "latin1") || bytes.includes(name, 0, "utf16le"));

  test.each([
    ["a name that no type declares", spell("undeclared", "T30"), spell("never", "GivenT31")],
    ["a name that a type declares and nothing stores", spell("neverNamed", "T24"), spell("given", "T21")],
  ])("an object takes %s from outside as under plain Bun", async (_, name, text) => {
    const json = JSON.stringify({ readT13: 3, [spell("neverRead", "T14")]: "x", [name]: 4 });
    const commands = [[executable], [bunExe(), "run", "./main.ts"]];
    const [compiled, plain] = await Promise.all(
      commands.map(command =>
        spawned([...command, name, json, text, "return Object.keys(handedOn).join()"], folder, bunEnv),
      ),
    );
    expect({ stdout: compiled.stdout, stderr: compiled.stderr, exitCode: compiled.exitCode }).toEqual({
      stdout: plain.stdout,
      stderr: "",
      exitCode: 0,
    });
    expect(compiled.stdout).toContain(`2 storedT23,${name} {"storedT23":1,"${name}":2}`);
  });

  test("the executable holds what the program stores, reads, makes and compares with", () => {
    const names = ["storedT2", "storedT23", "readT13", "madeT16", "comparedT20", "usedLevelTextT34"];
    expect(found(names)).toEqual(names);
  });

  eachRow([
    [
      "a declared member that nothing stores",
      ["neverStoredT3", "neverStoredObjectT4", "innerOfNeverStoredT5", "neverStoredModeT39", "neverStoredTextT40"],
    ],
    [
      "a key of a Record or of a mapped type that nothing stores",
      ["neverStoredKeyT7", "otherNeverStoredKeyT8", "neverStoredMappedT10", "otherNeverStoredMappedT11"],
    ],
    [
      "a declared member that no code names, of an object that a store under a computed name may reach",
      ["neverNamedT24"],
    ],
    [
      "a member of a union of literal types that the program never makes and nothing from outside is tested for",
      ["neverMadeT17", "otherNeverMadeT18"],
    ],
    [
      "a const enum, its members and the values that are not used",
      ["LevelT32", "usedLevelT33", "unusedLevelT35", "unusedLevelTextT36"],
    ],
  ] as [string, string[]][])("the executable does not hold %s", (_, names) => {
    expect(found(names)).toEqual([]);
  });

  // The compiler's own reports show them, so only a build that shortens names is without them.
  test.skipIf(!flagsOfBuild.length)("the executable does not hold the names of interfaces and type aliases", () => {
    expect(found(namesOfTypes)).toEqual([]);
  });
});
