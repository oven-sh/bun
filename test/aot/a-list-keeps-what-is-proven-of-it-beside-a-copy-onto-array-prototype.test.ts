// `Object.assign(Array.prototype, { [name]: value })` with a name spelled at run time: the object that is copied from goes out of sight, and a getter that nobody knows may
// be put on it. A lookup meets that object only where an object on the chain can take the member from the copy. The analysis used to count it for every list that was looked
// up together with a value nobody knows, unless another receiver of the same lookup happened to come to a member of a built-in prototype: so a list that is only handed to
// `new Uint8Array(list)` lost its contents, and whether it did went by the order in which the rules of the analysis ran.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { built, spawned } from "./harness/commands";
import { printIR, test, writesProgramInto } from "./harness/printed-ir";

const program = `
function say(title: string, answer: string): void {}
function spell(first: string, second: string): string {
  return [first, second].join("");
}
function double(x: number): number {
  return x * 2;
}
function nameOfError(error: unknown): string {
  return "throws " + (error as Error).constructor.name;
}
class Quiet extends Array<number> {}
function put(target: any, key: string, value: unknown): void {
  Object.assign(target, { [key]: value });
}
function read(it: Quiet): string {
  try {
    return String(it.map(double));
  } catch (error) {
    return nameOfError(error);
  }
}
say("map:", read(Quiet.from([1, 2, 3]) as Quiet));
{
  const made: Uint8Array = new Uint8Array([4, 5, 6]);
}
put(Array.prototype, spell("fi", "rst"), "array above");
`;

test("the list handed to new Uint8Array() is known to hold 4 to 6 and to be as it was made", async () => {
  using dir = tempDir("aot-list-beside-a-copy", { "main.ts": program, "tsconfig.json": "{}" });
  const folder = String(dir);
  built(
    await spawned(
      [bunExe(), "build", "--compile", "--aot", writesProgramInto(folder), "main.ts", "--outfile", "main"],
      folder,
      { ...bunEnv, NO_COLOR: "1" },
    ),
  );
  const lines = (await printIR(folder, { until: "ApplyFlowResults" })).split("\n");
  const construction = lines.find(line => line.includes(` calleeName="Uint8Array" `));
  const list = construction?.match(/ = Construct v\d+, -, (v\d+) /)?.[1];
  const typeOfList = lines.find(line => line.startsWith(`    ${list}: `))?.match(/^ +v\d+: (.*?) = /)?.[1];
  expect(typeOfList).toBe("Array<int[4, 6], proven, pristine[Storage, Names, Dense]>");
}, 120_000);
