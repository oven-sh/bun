// An executable runs a built-in module where a name of it is first read, and not where the file that imports it is linked, if nothing can tell
// when the load ran: src/codegen/builtins/data/acts-at-load.txt says of which modules that holds, and where the importer links the host asks
// whether the program can write what the load reads. The stored programs under parallel/builtin-modules hold what a program prints. This
// file counts: a module that ran called the run time for each module that it requires.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  // node:vm requires three modules when it runs, node:dns three, node:url four.
  "reads-on-demand.mjs": `
    import { runInNewContext } from "node:vm";
    import dns, { lookup } from "node:dns";
    import * as url from "node:url";
    import os from "node:os";
    const asked = process.argv[2];
    const read = { vm: () => runInNewContext("6 * 7"), dns: () => typeof lookup + typeof dns.resolve, url: () => url.format(url.parse("http://example.com/a")), os: () => typeof os.cpus };
    console.log(asked in read ? read[asked]() : "nothing read");
  `,
  // The statement does not run. The build has seen it, so the program may write Error, which the load of node:vm reads.
  "writes-what-a-load-reads.mjs": `
    import { runInNewContext } from "node:vm";
    if (process.argv.length > 5) {
      globalThis.Error = class Mine {};
      console.log(runInNewContext("1"));
    }
    console.log("nothing read");
  `,
  // The load of node:http reads the environment.
  "load-that-shows.mjs": `
    import http from "node:http";
    console.log(process.argv.length > 5 ? http.METHODS : "nothing read");
  `,
};

async function build(dir: string, entry: string) {
  const executable = join(dir, entry.replace(".mjs", isWindows ? ".exe" : ""));
  const built = await run([bunExe(), "build", "--compile", "--aot", entry, "--outfile", executable], dir, bunEnv);
  expect(built.exitCode).toBe(0);
  return executable;
}

/** What the executable prints, and how many modules were asked for by code of Bun's library or by a first read. */
async function ran(dir: string, executable: string, ...operands: string[]) {
  const path = `${executable}.${operands.join("-")}.counts`;
  // A warning of url.parse() is not what this holds.
  const environment = { ...bunEnv, BUN_JSC_aotCountsPath: path, NODE_NO_WARNINGS: "1" };
  const { stdout, exitCode } = await run([executable, ...operands], dir, environment);
  const counted = readFileSync(path, "utf8")
    .split("\n")
    .find(line => line.endsWith("\toperation:operationAOTRequireModule"));
  return { stdout, exitCode, modulesAskedFor: Number(counted?.split("\t")[0]) };
}

test("a built-in module whose load shows nowhere runs where a name of it is first read", async () => {
  using dir = tempDir("aot-load-at-first-use", files);
  const executable = await build(String(dir), "reads-on-demand.mjs");
  expect(await ran(String(dir), executable)).toEqual({ stdout: "nothing read\n", exitCode: 0, modulesAskedFor: 0 });
  const plain = async (asked: string) =>
    (await run([bunExe(), "reads-on-demand.mjs", asked], String(dir), bunEnv)).stdout;
  // node:os requires nothing.
  for (const asked of ["vm", "dns", "url"]) {
    const compiled = await ran(String(dir), executable, asked);
    expect({ asked, stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({
      asked,
      stdout: await plain(asked),
      exitCode: 0,
    });
    // The read asks for the module once, and the module for what it requires. Three other modules would ask for ten more.
    expect(compiled.modulesAskedFor).toBeGreaterThan(0);
    expect(compiled.modulesAskedFor).toBeLessThan(8);
  }
}, 240_000);

test("a module runs where its importer is linked if the program can write what its load reads, or if its load shows", async () => {
  using dir = tempDir("aot-load-at-first-use", files);
  const writes = await build(String(dir), "writes-what-a-load-reads.mjs");
  const written = await ran(String(dir), writes);
  expect({ stdout: written.stdout, exitCode: written.exitCode }).toEqual({ stdout: "nothing read\n", exitCode: 0 });
  expect(written.modulesAskedFor).toBeGreaterThan(0);

  const shows = await build(String(dir), "load-that-shows.mjs");
  const shown = await ran(String(dir), shows);
  expect({ stdout: shown.stdout, exitCode: shown.exitCode }).toEqual({ stdout: "nothing read\n", exitCode: 0 });
  expect(shown.modulesAskedFor).toBeGreaterThan(0);
}, 360_000);
