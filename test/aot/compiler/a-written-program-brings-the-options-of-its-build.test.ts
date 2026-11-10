// Which code a build leaves out, what it admits and which features it keeps are options of the engine and no part of the program.
// `--aot-out` writes the record of them behind the program's bytes, and testaot starts from that record: without a word on its command
// line it compiles what the build compiled. Before, it compiled every written program as if --aot-allow-code-from-disk had been given.
//
// The two images are not the same bytes: Bun calls its own host functions at their addresses, which testaot does not have. What is held
// together here is the engine's own list of what it compiled: every unit by its function, its role and its file.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runTool, testaot } from "../engine/testaot";
import { without } from "../harness/capabilities";
import { built, spawned } from "../harness/commands";
import { buildEnvironment, buildFlags, compileCommand, withProgramOutput, withThreads } from "../harness/flags";
import { test } from "../supported";

// A CommonJS file can name a file at run time, so a build that admits code from disk keeps more of the library for it.
const program = `
const shelf = { rows: [] };
function lay(row) {
  shelf.rows.push(row);
  return shelf.rows.length;
}
let laid = 0;
for (let turn = 0; turn < 4; turn++) laid += lay(turn);
console.log(laid, typeof require);
`;

const flavors = { closed: [], open: ["--aot-allow-code-from-disk"] } as const;

/** Every unit that the engine compiled: `F`, its number, address, size, three counts, the function's name, the role, a count, the file. */
const unitsIn = (map: string) =>
  readFileSync(map, "utf8")
    .split("\n")
    .filter(line => line.startsWith("F\t"))
    .map(line => line.split("\t"))
    .map(fields => [fields[7], fields[8], fields[10]].join(" "));

const declared = without("testaot") ? test.skip : test;

declared(
  "testaot compiles a written program by the options of the build that wrote it",
  async () => {
    using folder = tempDir("aot-options-behind-the-program", { "main.cjs": program });
    const at = (name: string) => join(String(folder), name);

    async function write(name: string, ...flags: string[]) {
      const env = { ...bunEnv, [buildEnvironment.mapFilePath]: at(`${name}.map-of-bun`) };
      const words = [withProgramOutput(at(name)), buildFlags.withoutExecutable, ...flags];
      built(await spawned([bunExe(), ...compileCommand, ...words, "main.cjs"], String(folder), env));
      return readFileSync(at(name));
    }
    async function compileAgain(name: string) {
      const env = { JSC_aotMapFilePath: at(`${name}.map-of-testaot`) };
      const { stderr, exitCode } = await runTool(
        [testaot!, "compile", at(name), `--output=${at(name)}.image`],
        String(folder),
        env,
      );
      expect({ name, exitCode }).toEqual({ name, exitCode: 0 });
      return { units: unitsIn(at(`${name}.map-of-testaot`)), stderr };
    }

    const closed = await write("closed", ...flavors.closed);
    const open = await write("open", ...flavors.open);

    // One program. What differs lies in the record behind it.
    expect(open.length).toBe(closed.length);
    const firstDifference = closed.findIndex((byte, index) => byte !== open[index]);
    expect(firstDifference).toBeGreaterThan(closed.length - 1024);

    const units = { closed: unitsIn(at("closed.map-of-bun")), open: unitsIn(at("open.map-of-bun")) };
    // Else what follows would hold whatever testaot did.
    expect(units.open.length).toBeGreaterThan(units.closed.length);
    for (const name of ["closed", "open"] as const) {
      const again = await compileAgain(name);
      expect(again.stderr).not.toContain("brings no options");
      expect(again.units).toEqual(units[name]);
    }

    // Bytes without the record are compiled with nothing left out, and testaot says so.
    writeFileSync(at("bare"), closed.subarray(0, programLength(closed)));
    const bare = await compileAgain("bare");
    expect(bare.stderr).toContain("brings no options");
    expect(bare.units).not.toEqual(units.closed);

    // How many threads compile is no part of what is compiled.
    expect((await write("one-thread", withThreads(1))).equals(await write("three-threads", withThreads(3)))).toBe(true);
  },
  300_000,
);

/** The header of a program: the magic number in four bytes, the hash of the schema in eight, then how many bytes the program has. */
function programLength(file: Buffer) {
  return file.readUInt32LE(12);
}
