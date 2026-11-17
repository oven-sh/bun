// Runs alone: it judges by the processor seconds of a build.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { reads } from "./harness/reads";
import { test } from "./supported";

// wide.mjs hands on everything of eight files, and each of them takes every name back from wide.mjs by a statement. So each such
// statement leads round in a ring, and while one is followed all the others come to stand in progress, one below the other. Each
// read of a statement in progress looked for it through all that stood in progress, so a build took the cube of their number.
function project(names: number) {
  const takers = Array.from({ length: 8 }, (_, index) => `taker${index}.mjs`);
  const listed = Array.from({ length: names }, (_, index) => `n${index}`);
  const files: Record<string, string> = {
    "package.json": `{ "type": "module" }`,
    "deep.cjs": listed.map((name, index) => `exports.${name} = ${index};\n`).join(""),
    "open.mjs": `export * from "./deep.cjs";\n`,
    "wide.mjs": [...takers, "open.mjs"].map(file => `export * from "./${file}";\n`).join(""),
    "main.mjs": `import * as all from "./wide.mjs";\nconsole.log(all.n7, Object.keys(all).length);\n`,
  };
  for (const taker of takers)
    files[taker] = `export { ${listed.join(", ")} } from "./wide.mjs";\nexport * from "./deep.cjs";\n`;
  return files;
}

async function build(names: number) {
  using dir = tempDir("aot-names-taken-back-from-a-barrel", project(names));
  const folder = String(dir);
  const executable = join(folder, isWindows ? "compiled.exe" : "compiled");
  await using built = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", executable],
    cwd: folder,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([built.stderr.text(), built.exited]);
  expect({ stderr: stderr.split("\n").filter(line => line.startsWith("error")), exitCode }).toEqual({
    stderr: [],
    exitCode: 0,
  });
  const said = (cmd: string[]) => Bun.spawnSync({ cmd, cwd: folder, env: bunEnv }).stdout.toString();
  expect(said([executable])).toBe(said([bunExe(), "./main.mjs"]));
  return Number(built.resourceUsage()!.cpuTime.user) / 1e6;
}

test("twice the names cost a build four times the processor seconds, not eight", async () => {
  const few = Math.min(await build(200), await build(200));
  const many = Math.min(await build(400), await build(400));
  reads("twice the names taken back from a barrel", many / few, 5, "times the processor seconds");
  if (!isASAN && !isDebug) expect(many / few).toBeLessThan(5);
}, 240_000);
