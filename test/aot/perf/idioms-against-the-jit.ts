// Every idiom of ./idioms and ./everyday, compiled ahead of time as TypeScript and as JavaScript, against the same JavaScript under the same binary's JIT.
//
//   bun test/aot/perf/idioms-against-the-jit.ts [--bun <path>] [--only <regular expression>] [--jobs 16] [--rows 60]
//       [--out rows.tsv] [--against rows.tsv] [--write-behind] [--keep <folder>] [--build-flag <flag>].. [--in-a-very-large-program]
//
// It prints how many idioms are ahead | level (within 5%) | behind, then every idiom that takes over 1.2 times the JIT's instructions, worst first, then those
// that collect or hold much more than the JIT does, or hold more the longer they run. Every form must print the same.
//
// The cost of one turn is the difference between a run of n turns and a run of n / 4, divided by 3n / 4: start-up, warm-up and the JIT's compiling cancel out, so the
// JIT's column is its last tier. Collections run on the program's own thread and the JIT compiles on it too. Instructions are counted in user mode around the whole
// process: the same at any load. A cost under half an instruction counts as half. Collections and the most memory resident are those of the long run.
//
// --out writes a row an idiom; --against reads such a file of an earlier build and lists what came under 1.2 times, what went over it, and what a compiled form gained
// or lost by over 10% and 3 instructions, and where the JIT's own number moved. --write-behind rewrites ./behind-the-jit.<os>-<arch>.json and ./typed-dearer-than-untyped.<os>-<arch>.json, the idioms that ./idioms-against-the-jit.test.ts lists as todo.
// --keep leaves the programs' sources in the folder. Each --build-flag goes to every `bun build --compile --aot`: with --against, what an option of the compiler is worth.
// --in-a-very-large-program compiles every idiom as its text would be compiled inside a very large program, where little counts as code that runs often, and lets the loop
// of an idiom of ./everyday find turn() at run time, under the JIT too. --write-behind then rewrites ./behind-the-jit-in-a-very-large-program.<os>-<arch>.json alone.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { parseArgs } from "util";
import {
  behindInVeryLargeProgramPath,
  behindPath as behindByDefaultPath,
  type Cost,
  dearerPath,
  idiomsAgainstTheJit,
  isTypedDearer,
  isWhole,
  ratioOf,
  type Row,
  typedOverUntyped,
  type WholeRow,
} from "./measure-idioms";

const { values: options } = parseArgs({
  options: {
    bun: { type: "string", default: process.execPath },
    only: { type: "string", default: "" },
    jobs: { type: "string", default: "16" },
    rows: { type: "string", default: "60" },
    out: { type: "string" },
    against: { type: "string" },
    "write-behind": { type: "boolean", default: false },
    keep: { type: "string" },
    "build-flag": { type: "string", multiple: true, default: [] },
    "in-a-very-large-program": { type: "boolean", default: false },
  },
});
const inVeryLargeProgram = options["in-a-very-large-program"];
const behindPath = inVeryLargeProgram ? behindInVeryLargeProgramPath : behindByDefaultPath;
const folder = options.keep ? resolve(options.keep) : mkdtempSync(join(tmpdir(), "idioms-against-the-jit-"));
mkdirSync(folder, { recursive: true });
const { names: all, measure } = idiomsAgainstTheJit(resolve(options.bun), folder, {
  buildFlags: options["build-flag"],
  inVeryLargeProgram,
});
const names = all.filter(name => new RegExp(options.only).test(name));

const rows: Row[] = [];
const waiting = [...names];
await Promise.all(
  Array.from({ length: Number(options.jobs) }, async () => {
    for (let name = waiting.shift(); name; name = waiting.shift()) {
      rows.push(await measure(name));
      if (rows.length % 50 === 0) console.error(`${rows.length} of ${names.length}`);
    }
  }),
);
if (!options.keep) rmSync(folder, { recursive: true, force: true });

const whole = rows.filter(isWhole).sort((a, b) => ratioOf(b) - ratioOf(a));
const three = (row: WholeRow, of: (cost: Cost) => number, digits = 0) =>
  [row.typed, row.untyped, row.jit].map(cost => of(cost).toFixed(digits).padStart(9)).join(" ");
const line = (row: WholeRow) =>
  `${ratioOf(row).toFixed(2).padStart(7)}  ${three(row, cost => cost.instructions, 1)}  |${three(row, cost => cost.collections)}  |${three(row, cost => cost.peakMegabytes)}  ${row.name}`;
const heading = `  ratio  instructions a turn: typed, untyped, JIT  | collections: typed, untyped, JIT  | most MB resident: typed, untyped, JIT`;
const count = (test: (ratio: number) => boolean) => whole.filter(row => test(ratioOf(row))).length;

if (options.out)
  writeFileSync(
    options.out,
    rows
      .map(row =>
        [
          row.name,
          ...[row.typed, row.untyped, row.jit].flatMap(cost => [
            cost?.instructions.toFixed(1),
            cost?.collections,
            cost?.peakMegabytes.toFixed(1),
          ]),
          row.failure ?? "",
        ].join("\t"),
      )
      .sort()
      .join("\n") + "\n",
  );
if (options["write-behind"]) {
  const measured = new Set(rows.map(row => row.name));
  const before: Record<string, number> = existsSync(behindPath) ? JSON.parse(readFileSync(behindPath, "utf8")) : {};
  const behind = [
    ...Object.entries(before).filter(([name]) => !measured.has(name) && all.includes(name)),
    ...whole.filter(row => ratioOf(row) > 1.2).map(row => [row.name, Math.round(ratioOf(row) * 100) / 100] as const),
  ].sort(([a], [b]) => (a < b ? -1 : 1));
  writeFileSync(behindPath, JSON.stringify(Object.fromEntries(behind), null, 2) + "\n");
  if (!inVeryLargeProgram) {
    const dearerBefore: Record<string, number> = existsSync(dearerPath)
      ? JSON.parse(readFileSync(dearerPath, "utf8"))
      : {};
    const dearer = [
      ...Object.entries(dearerBefore).filter(([name]) => !whole.some(row => row.name === name) && all.includes(name)),
      ...whole
        .filter(row => isTypedDearer(row))
        .map(row => [row.name, Math.round(typedOverUntyped(row) * 100) / 100] as const),
    ].sort(([a], [b]) => (a < b ? -1 : 1));
    writeFileSync(dearerPath, JSON.stringify(Object.fromEntries(dearer), null, 2) + "\n");
  }
}

console.log(
  `${names.length} idioms: ${count(ratio => ratio < 0.95)} ahead | ${count(ratio => ratio >= 0.95 && ratio <= 1.05)} level | ${count(ratio => ratio > 1.05)} behind; ` +
    `${count(ratio => ratio > 1.2)} over 1.2 times, ${count(ratio => ratio > 2)} over 2 times`,
);
for (const row of rows) if (row.failure) console.log(`FAILS ${row.name}: ${row.failure}`);

if (options.against) {
  const before = new Map(
    readFileSync(options.against, "utf8")
      .split("\n")
      .map(text => text.split("\t"))
      .filter(fields => fields[7])
      .map(fields => [fields[0], { typed: Number(fields[1]), untyped: Number(fields[4]), jit: Number(fields[7]) }]),
  );
  const moved = whole.flatMap(row => {
    const then = before.get(row.name);
    if (!then) return [];
    const [was, is] = [Math.max(then.typed, then.untyped), Math.max(row.typed.instructions, row.untyped.instructions)];
    return [
      {
        name: row.name,
        was,
        is,
        ratioWas: was / then.jit,
        ratioIs: ratioOf(row),
        jitWas: then.jit,
        jitIs: row.jit.instructions,
      },
    ];
  });
  const list = (title: string, of: typeof moved) => {
    console.log(`\n${of.length} ${title}`);
    for (const { name, was, is, ratioWas, ratioIs } of of.slice(0, Number(options.rows)))
      console.log(
        `  ${was.toFixed(1).padStart(9)} > ${is.toFixed(1).padStart(9)}  ${ratioWas.toFixed(2).padStart(7)} > ${ratioIs.toFixed(2).padStart(7)}  ${name}`,
      );
  };
  const byGain = (a: (typeof moved)[0], b: (typeof moved)[0]) => a.is / a.was - b.is / b.was;
  list(
    "came under 1.2 times (instructions a turn, then the ratio to the JIT)",
    moved.filter(row => row.ratioWas > 1.2 && row.ratioIs <= 1.2).sort(byGain),
  );
  list(
    "went over 1.2 times",
    moved.filter(row => row.ratioWas <= 1.2 && row.ratioIs > 1.2).sort((a, b) => byGain(b, a)),
  );
  list(
    "take over 10% fewer instructions",
    moved.filter(row => row.is < row.was * 0.9 && row.is < row.was - 3).sort(byGain),
  );
  list(
    "take over 10% more instructions",
    moved.filter(row => row.is > row.was * 1.1 && row.is > row.was + 3).sort((a, b) => byGain(b, a)),
  );
  const yardstick = moved.filter(
    row => Math.abs(row.jitIs - row.jitWas) > 3 && (row.jitIs > row.jitWas * 1.25 || row.jitIs < row.jitWas * 0.8),
  );
  console.log(`\n${yardstick.length} whose JIT moved by over a quarter: there the ratio says nothing of the compiler`);
  for (const { name, jitWas, jitIs } of yardstick.slice(0, Number(options.rows)))
    console.log(`  ${jitWas.toFixed(1).padStart(9)} > ${jitIs.toFixed(1).padStart(9)}  ${name}`);
}

console.log(`\n${heading}`);
for (const row of whole.filter(row => ratioOf(row) > 1.2).slice(0, Number(options.rows))) console.log(line(row));
const most = (row: WholeRow, of: (cost: Cost) => number) => Math.max(of(row.typed), of(row.untyped));
const collectsMore = whole.filter(row => most(row, cost => cost.collections) > 2 * row.jit.collections + 5);
console.log(`\n${collectsMore.length} collect over twice as often as the JIT\n${heading}`);
for (const row of collectsMore.slice(0, Number(options.rows))) console.log(line(row));
const holdsMore = whole.filter(row => most(row, cost => cost.peakMegabytes) > 1.3 * row.jit.peakMegabytes + 8);
console.log(`\n${holdsMore.length} hold over 1.3 times what the JIT holds\n${heading}`);
for (const row of holdsMore.slice(0, Number(options.rows))) console.log(line(row));
const grows = (cost: Cost) => cost.peakMegabytes > 1.5 * cost.peakMegabytesOfAQuarter + 8;
const growsWithTurns = whole.filter(row => (grows(row.typed) || grows(row.untyped)) && !grows(row.jit));
console.log(
  `\n${growsWithTurns.length} hold more the longer they run, and under the JIT do not: most MB resident at a quarter of the turns > at all of them: typed, untyped, JIT`,
);
for (const row of growsWithTurns.slice(0, Number(options.rows)))
  console.log(
    `  ${[row.typed, row.untyped, row.jit].map(cost => `${cost.peakMegabytesOfAQuarter.toFixed(0).padStart(5)} > ${cost.peakMegabytes.toFixed(0).padStart(5)}`).join("  |")}  ${row.name}`,
  );
