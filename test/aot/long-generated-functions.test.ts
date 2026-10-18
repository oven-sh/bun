import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

const n = isDebug || isASAN ? 4_000 : 16_000;
const parts = (part: (k: number) => string) => Array.from({ length: n }, (_, k) => part(k)).join("");
const inOneFunction = (body: string) => `function run(o, r, i) {\n${body}\n  return r.length;\n}\nconsole.log(run({ f: 1, g: 2, s: "x" }, [], 0));\n`;

async function run(cwd: string, cmd: string[]) {
  await using ran = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
  return { stdout, stderr, exitCode };
}

// The time of the build grew with the cube of the length: two minutes for these 16,000 cases in a release build.
test.each([["a switch of numbers", inOneFunction(`  switch (i) {\n${parts(k => `    case ${k + 1}: r.push(${k}); break;\n`)}  }`), "0\n"]])(
  "%s as long as a generator writes it is built in time that grows with its length",
  async (_, source, expected) => {
    using dir = tempDir("long-generated-functions", { "main.js": source });
    const outfile = join(String(dir), "out" + (isWindows ? ".exe" : ""));
    const built = await run(String(dir), [bunExe(), "build", "--compile", "--aot", "./main.js", "--outfile", outfile]);
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(await run(String(dir), [outfile])).toEqual({ stdout: expected, stderr: "", exitCode: 0 });
  },
  60_000,
);

// The time and the memory of the build grew with the square of the length: 46 s for these 16,000 blocks in a release build, and 3.4 GB for half as many.
test(
  "try blocks whose catch clauses hand their parameters on, as many as a generator writes",
  async () => {
    using dir = tempDir("long-generated-functions", { "main.js": inOneFunction(parts(() => "  try { r.push(o.f); } catch (e) { r.push(e); }\n")) });
    const outfile = join(String(dir), "out" + (isWindows ? ".exe" : ""));
    const built = await run(String(dir), [bunExe(), "build", "--compile", "--aot", "./main.js", "--outfile", outfile]);
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(await run(String(dir), [outfile])).toEqual({ stdout: n + "\n", stderr: "", exitCode: 0 });
  },
  isDebug || isASAN ? 240_000 : 30_000,
);

// The time of the front end grew with the square of the length: 47 s for 48,000 loops in a release build.
test(
  "loops in a row, as many as a generator writes, are translated in time that grows with their number",
  async () => {
    const loops = Array.from({ length: 4 * n }, (_, k) => `  for (var j${k} = 0; j${k} < 1; j${k}++) r.push(j${k});\n`).join("");
    using dir = tempDir("long-generated-functions", { "main.js": inOneFunction(loops) });
    const checked = await run(String(dir), [bunExe(), "check", "--aot", "./main.js"]);
    expect({ stderr: checked.exitCode ? checked.stderr : "", exitCode: checked.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  },
  isDebug || isASAN ? 240_000 : 30_000,
);

// Front-end time was quadratic in the number of rows: 16 s for 16,000 rows in a release build.
test(
  "large `as const` table compiles in linear time",
  async () => {
    const rows = Array.from({ length: 2 * n }, (_, k) => `  { id: ${k}, name: "n${k}", on: ${k % 2 === 1} },\n`).join("");
    const source = `const table = [\n${rows}] as const;\nexport let total = 0;\nfor (const row of table) total += row.id;\nexport const second = table[1].name;\n`;
    using dir = tempDir("long-generated-functions", { "main.ts": source });
    const checked = await run(String(dir), [bunExe(), "check", "--aot", "./main.ts"]);
    expect({ stderr: checked.exitCode ? checked.stderr : "", exitCode: checked.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  },
  isDebug || isASAN ? 240_000 : 30_000,
);

test(
  "a typed function that a loop calls and that joins strings in a chain as long as a generator writes it is built in time that grows with its length",
  async () => {
    const source = `function build(a: string, n: number): string {\n  let s = a;\n${parts(() => "  s = s + n + a;\n")}  return s;\n}\nlet total = 0;\nfor (let i = 0; i < 3; i++) total += build("ab", i).length;\nconsole.log(total);\n`;
    using dir = tempDir("long-generated-functions", { "main.ts": source });
    const outfile = join(String(dir), "out" + (isWindows ? ".exe" : ""));
    const built = await run(String(dir), [bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", outfile]);
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(await run(String(dir), [outfile])).toEqual({ stdout: 3 * (2 + 3 * n) + "\n", stderr: "", exitCode: 0 });
  },
  isDebug || isASAN ? 240_000 : 60_000,
);
