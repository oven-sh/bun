// A table such as TypeScript's `Diagnostics`: two hundred entries, each the result of one small function that is called with constants. The build puts the making of the table off to its first read,
// in a function of its own. That function takes what the stretch of the module's body took: each constant stands in front of the call that takes it. And code that runs once calls the small function:
// a copy of it at each entry would take more.
import { expect } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { run } from "./harness/run";
import { test } from "./supported";

const entries = Array.from({ length: 200 }, (_, index) => index + 1);
const types = `export enum Category { Warning, Error, Suggestion, Message }
export interface Message { code: number; category: Category; key: string; message: string; unnecessary?: {}; }
`;
const maker = `function make(code: number, category: Category, key: string, message: string, unnecessary?: {}): Message {
  return { code, category, key, message, unnecessary };
}
`;
const head = `import { Category, Message } from "./types";\n`;
const madeByCalls = (category: string) => `${head}${maker}export const table = {
${entries.map(n => `  Name_${n}: make(${n}, ${category}, "Name_${n}", "Message number ${n}."),`).join("\n")}
};
`;
const writtenOut = (category: string) => `${head}export const table: Record<string, Message> = {
${entries.map(n => `  Name_${n}: { code: ${n}, category: ${category}, key: "Name_${n}", message: "Message number ${n}.", unnecessary: undefined },`).join("\n")}
};
`;
// A member of an enum of another file is its value, so the two are one program.
const spellings = ["Category.Error", "1"];
const main = `import { table } from "./table";
const all: Record<string, { code: number; category: number; key: string; message: string }> = table;
const picked = all[process.argv.length > 99 ? "Name_7" : "Name_100"];
console.log(picked.code, picked.category, picked.key, picked.message, Object.keys(all).length);
`;

async function codeBytes(table: string, flags: string[] = []) {
  using dir = tempDir("aot-long-table", { "main.ts": main, "table.ts": table, "types.ts": types });
  const cwd = String(dir);
  const executable = join(cwd, isWindows ? "main.exe" : "main");
  const map = join(cwd, "main.map");
  const command = [bunExe(), "build", "--compile", "--aot", ...flags, "./main.ts", "--outfile", executable];
  const built = await run(command, cwd, { ...bunEnv, BUN_JSC_aotMapFilePath: map });
  expect({ output: built.exitCode ? built.stdout + built.stderr : "", exitCode: built.exitCode }).toEqual({
    output: "",
    exitCode: 0,
  });
  expect((await run([executable], cwd)).stdout).toBe("100 1 Name_100 Message number 100. 200\n");
  let bytes = 0;
  for (const line of readFileSync(map, "utf8").split("\n")) {
    const fields = line.split("\t");
    if (fields[0] === "F") bytes += Number(fields[3]);
  }
  return bytes;
}

// The entry and the exit of the function, the test at the read, and the call.
const bytesOfOneMoreFunction = 256;

test.each(spellings)(
  "to put the making of a long table off costs no code but that of one more function: %s",
  async category => {
    const [putOff, inBody] = await Promise.all([
      codeBytes(madeByCalls(category)),
      codeBytes(madeByCalls(category), ["--aot-disable=pass:DeferInitializers"]),
    ]);
    expect(putOff).toBeLessThanOrEqual(inBody + bytesOfOneMoreFunction);
  },
  240_000,
);

test.each(spellings)(
  "a long table of calls of a small function takes less code than the table written out: %s",
  async category => {
    const [calls, literals] = await Promise.all([codeBytes(madeByCalls(category)), codeBytes(writtenOut(category))]);
    expect(calls).toBeLessThan(literals);
  },
  240_000,
);

test("a member of an enum of another file costs what its value costs", async () => {
  const [member, value] = await Promise.all(spellings.map(category => codeBytes(madeByCalls(category))));
  // The file of the enum has a body of its own, which does nothing.
  expect(Math.abs(member - value)).toBeLessThanOrEqual(16);
}, 240_000);
