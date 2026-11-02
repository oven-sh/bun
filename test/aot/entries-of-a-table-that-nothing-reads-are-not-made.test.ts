// A table of two hundred entries, each the answer of one function that makes a few objects. The program reads two of the entries. The fields of the others go, and the calls that filled them go too:
// all that such a call does is make objects that nobody sees. So the long table takes the code of a table with the two entries alone.
import { expect } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { run } from "./harness/run";
import { test } from "./supported";

const maker = `function entry(code, key, message) {
  return {
    code, key, message,
    range: { start: { line: code, column: 0 }, end: { line: code + 1, column: 0 } },
    related: { first: { code: code + 1, key }, second: { code: code + 2, key }, third: { code: code + 3, key } },
    flags: { isError: code > 100, isWarning: code <= 100, isShown: false, isElided: false },
  };
}
`;
const tableOf = (numbers: number[]) => `${maker}export const table = {
${numbers.map(n => `  name${n}: entry(${n}, "name${n}", "Message number ${n}."),`).join("\n")}
};
`;
const main = `import { table } from "./table.js";
const picked = process.argv.length > 99 ? table.name7 : table.name100;
console.log(picked.code, picked.key, picked.message, picked.range.end.line, picked.related.third.code, picked.flags.isError);
`;

async function codeBytes(table: string) {
  using dir = tempDir("aot-unread-entries", { "main.js": main, "table.js": table });
  const cwd = String(dir);
  const executable = join(cwd, isWindows ? "main.exe" : "main");
  const map = join(cwd, "main.map");
  const command = [bunExe(), "build", "--compile", "--aot", "./main.js", "--outfile", executable];
  const built = await run(command, cwd, { ...bunEnv, BUN_JSC_aotMapFilePath: map });
  expect({ output: built.exitCode ? built.stdout + built.stderr : "", exitCode: built.exitCode }).toEqual({
    output: "",
    exitCode: 0,
  });
  expect((await run([executable], cwd)).stdout).toBe("100 name100 Message number 100. 101 103 false\n");
  let bytes = 0;
  for (const line of readFileSync(map, "utf8").split("\n")) {
    const fields = line.split("\t");
    if (fields[0] === "F") bytes += Number(fields[3]);
  }
  return bytes;
}

test("entries that nothing reads take no code", async () => {
  const [all, onlyThoseRead] = await Promise.all([
    codeBytes(tableOf(Array.from({ length: 200 }, (_, index) => index + 1))),
    codeBytes(tableOf([7, 100])),
  ]);
  // With two calls the function is copied to where it is called, with two hundred it is a function of its own.
  expect(all).toBeLessThanOrEqual(onlyThoseRead + 256);
}, 240_000);
