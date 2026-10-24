import { afterAll, expect } from "bun:test";
import { rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { compileCommand } from "./harness/flags";
import { built, spawned } from "./run-programs";
import { beforeAll, describe, test } from "./supported";

const python = Bun.which("python3");
const script = join(import.meta.dir, "tools", "code_in_image.py");
if (!python) console.error("SKIPPED: test/aot/code-addresses-have-names.test.ts: python3 is not installed");

const sources = {
  "libraryK1.ts": `
export function functionK2(list: number[]) {
  let sum = 0;
  for (const item of list) sum += item;
  return sum;
}
export class ClassK3 {
  methodK4(text: string) {
    return text.replace(/patternK5+/g, "").length;
  }
}
`,
  "main.ts": `
import { ClassK3, functionK2 } from "./libraryK1";
function callerK6(count: number) {
  const list: number[] = [];
  for (let i = 0; i < count; i++) list.push(i);
  console.log(functionK2(list), new ClassK3().methodK4(process.argv.join(" ")));
}
callerK6(process.argv.length);
`,
};

describe.skipIf(!python)("compile/aot/code addresses have names", () => {
  const folder = String(tempDir("aot-code-addresses-have-names", sources));
  const executable = join(folder, isWindows ? "program.exe" : "program");
  const rows: string[][] = [];
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  beforeAll(async () => {
    built(await spawned([bunExe(), ...compileCommand, "./main.ts", "--outfile", executable], folder, bunEnv));
    const { stdout, stderr, exitCode } = await spawned([python!, script, executable, "functions", "K"], folder, bunEnv);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    for (const line of stdout.split(/\r?\n/)) if (line) rows.push(line.split("\t"));
  }, 300_000);

  test.each([
    ["functionK2", "libraryK1.ts:2:"],
    ["methodK4", "libraryK1.ts:8:"],
    ["callerK6", "main.ts:3:"],
  ])("%s is listed where it is defined, at %s", (name, place) => {
    const places = rows.filter(columns => columns[2] === name).map(columns => columns[3]);
    expect(places.length).toBeGreaterThan(0);
    for (const found of places) expect(found).toContain(place);
  });

  test("an address inside a function is given its name", async () => {
    const [offset, size] = rows.find(columns => columns[2] === "callerK6")!;
    const inside = (Number(offset) + (Number(size) >> 1)).toString(16);
    const { stdout, exitCode } = await spawned([python!, script, executable, "at", inside], folder, bunEnv);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("callerK6");
    expect(stdout).toContain("main.ts");
  });
});
