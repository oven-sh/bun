// Runs alone: it judges by the memory that a build holds and by its processor seconds.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { reads } from "./harness/reads";
import { test } from "./supported";

// A build runs the start of a program ahead of time to learn which patterns it makes. One store can make room for many places:
// a store of `length`, a store at a far index, a set made of a list. That room is counted like the places of a written list.
async function build(folder: string, name: string, files: Record<string, string>) {
  for (const [file, text] of Object.entries(files)) writeFileSync(join(folder, file), text);
  await using built = Bun.spawn({
    cmd: [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      `./${name}.cjs`,
      "--outfile",
      join(folder, name + (isWindows ? ".exe" : "")),
    ],
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
  const usage = built.resourceUsage()!;
  return { bytes: usage.maxRSS, seconds: Number(usage.cpuTime.user) / 1e6 };
}

const room = 256 * 1024 * 1024;
const end = `function word(n) { return "a" + (n % 7); }
console.log(new RegExp(word(9)).source);
`;
const program = (made: string, turns: number) => `"use strict";
function load(turns) { const kept = []; for (let i = 0; i < turns; i++) { ${made} } return kept.length; }
if (process.argv[3] === "hoard") console.log(load(${turns}));
${end}`;

const makers = {
  "4000 lists whose length is laid at 99999": {
    made: "const list = []; list.length = 99999; kept[i] = list;",
    turns: 4000,
  },
  "80000 lists stored into at index 999": { made: "const list = []; list[999] = i; kept[i] = list;", turns: 80000 },
};

for (const [what, { made, turns }] of Object.entries(makers)) {
  test(`a build holds little of ${what}, on a way that the program never goes`, async () => {
    using dir = tempDir("aot-room-that-a-store-makes", {});
    const folder = String(dir);
    const one = await build(folder, "one", { "one.cjs": program(made, 1) });
    const many = await build(folder, "many", { "many.cjs": program(made, turns) });
    reads(`what a build holds of ${what}`, (many.bytes - one.bytes) / room, 3, "times the room of a build's first run");
    if (!isASAN && !isDebug) expect((many.bytes - one.bytes) / room).toBeLessThan(3);
  }, 240_000);
}

test("a build holds little of the sets that sixteen files make of a list", async () => {
  using dir = tempDir("aot-sets-of-many-files", {});
  const folder = String(dir);
  const file = (turns: number) => `"use strict";
const all = [];
function fill() { const list = []; for (let i = 0; i < 1000; i++) list[i] = i; for (let t = 0; t < ${turns}; t++) all[t] = new Set(list); return all.length; }
if (process.argv[3] === "hoard") fill();
exports.size = all.length;
`;
  const files = (name: string, turns: number) => {
    const all: Record<string, string> = {};
    let main = `"use strict";\nlet sum = 0;\n`;
    for (let index = 0; index < 16; index++) {
      all[`${name}-${index}.cjs`] = file(turns);
      main += `sum += require("./${name}-${index}.cjs").size;\n`;
    }
    all[`${name}.cjs`] = main + end;
    return all;
  };
  const one = await build(folder, "one", files("one", 1));
  const many = await build(folder, "many", files("many", 7500));
  reads(
    "what a build holds of the sets of sixteen files",
    (many.bytes - one.bytes) / room,
    3,
    "times the room of a build's first run",
  );
  if (!isASAN && !isDebug) expect((many.bytes - one.bytes) / room).toBeLessThan(3);
}, 240_000);

test("a build takes little longer for eight times the turns of a loop that lays a length and drops the list", async () => {
  using dir = tempDir("aot-lengths-laid-and-dropped", {});
  const folder = String(dir);
  const dropped = "const list = []; list.length = 99999; kept[0] = list;";
  const few = await build(folder, "few", { "few.cjs": program(dropped, 25000) });
  const many = await build(folder, "many", { "many.cjs": program(dropped, 200000) });
  reads("eight times the turns", many.seconds / few.seconds, 3, "times the processor seconds");
  expect(many.seconds / few.seconds).toBeLessThan(3);
}, 240_000);
