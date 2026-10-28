import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "./supported";

const files = {
  "main.mjs": `
    const box = JSON.parse("[null]");
    function hide(x) { box[0] = x; return box[0]; }
    function readKey(o, k) { return o[k]; }
    function hasKey(o, k) { return k in o; }
    const [, , way, sizeText, turnsText] = process.argv;
    const size = Number(sizeText), turns = Number(turnsText);
    const table = hide(JSON.parse("{}"));
    for (let i = 0; i < size; i++) table["k" + i] = i;
    const absent = [];
    for (let i = 0; i < 64; i++) absent.push("absent" + i);
    const names = hide(JSON.parse(JSON.stringify(absent)));
    for (const name of names) hide({})[name] = 1;
    let found = 0;
    if (way === "read") for (let i = 0; i < turns; i++) { if (readKey(table, names[i & 63]) !== undefined) found++; }
    else for (let i = 0; i < turns; i++) { if (hasKey(table, names[i & 63])) found++; }
    console.log(found === 0 && Object.keys(table).length === size);
  `,
};

const operations = [
  "operationAOTGetByValGeneric",
  "operationAOTGetByVal",
  "operationAOTGetByValAndCache",
  "operationAOTInByValGeneric",
  "operationAOTInByValAndCache",
];

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  await using ran = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
  return { stdout, stderr, exitCode };
}

test.skipIf(process.arch !== "x64")(
  "an object that serves as a dictionary of hundreds of names says without the run time that it lacks a name",
  async () => {
    using dir = tempDir("aot-objects-with-hundreds-of-names", files);
    const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable],
      String(dir),
      bunEnv,
    );
    expect({
      stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
      exitCode: built.exitCode,
    }).toEqual({ stderr: [], exitCode: 0 });
    const counted = async (way: string, size: number, turns: number) => {
      const path = join(String(dir), ["counts", way, size, turns].join("-"));
      const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path };
      expect(await run([executable, way, String(size), String(turns)], String(dir), env)).toEqual({
        stdout: "true\n",
        stderr: "",
        exitCode: 0,
      });
      let calls = 0;
      for (const line of readFileSync(path, "utf8").split("\n")) {
        const [count, name] = line.split("\toperation:");
        if (name !== undefined && operations.includes(name)) calls += Number(count);
      }
      return calls;
    };
    // One miss in sixteen leaves on purpose, and a name that meets four others in the table leaves too.
    const callsInAHundredTurns: Record<string, number | string> = {};
    for (const way of ["read", "in"]) {
      for (const size of [130, 300, 3000]) {
        const calls = ((await counted(way, size, 12800)) - (await counted(way, size, 6400))) / 64;
        callsInAHundredTurns[way + " " + size] = calls > 25 ? calls : "few";
      }
    }
    expect(callsInAHundredTurns).toEqual(
      Object.fromEntries(Object.keys(callsInAHundredTurns).map(row => [row, "few"])),
    );
  },
  240_000,
);
