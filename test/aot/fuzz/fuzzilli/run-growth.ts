// Does the time of a build grow with the program, or with its square? A shape is so many things of one kind and as many uses that may each meet all of them:
// records of as many layouts in one list and a function that reads as many names off its parameter. Each shape is built at a size and at four times that size, on one thread.
// What a build of an empty program costs is taken off both. Four times the program may then cost about four times as much: a shape that costs more than `--most` times as much (6) is kept.
// So is one whose large build costs more than `--rise` times (1.25) what an earlier table says: a square that has just begun shows there first. A table of the least that each shape ever cost makes that a ratchet.
//
//   bun run-growth.ts --bun <the Bun that builds> --work <folder> --finds <folder> [--size 6000] [--most 6] [--shape <name>] [--writes <table>] [--against <earlier table>] [--rise 1.25]
//
// It prints a line a shape: the two costs, in millions of instructions where `perf` is there and in milliseconds of processor time elsewhere, and the ratio of what they cost beyond an empty build.
// What it keeps: <finds>/growth-<shape>/{program.ts at the small size, report.txt}.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values: options } = parseArgs({
  options: {
    bun: { type: "string", default: process.execPath },
    work: { type: "string" },
    finds: { type: "string" },
    size: { type: "string", default: "6000" },
    most: { type: "string", default: "6" },
    shape: { type: "string", default: "" },
    against: { type: "string", default: "" },
    writes: { type: "string", default: "" },
    rise: { type: "string", default: "1.25" },
  },
});
const { bun, work, finds } = options as Record<string, string>;
if (!work || !finds) throw new Error("Expected --work and --finds");

const upTo = (n: number, each: (at: number) => string, between = "\n") =>
  Array.from({ length: n }, (_, at) => each(at)).join(between);

/** What there is so much of. Each leaves a list `things`. */
const makers: Record<string, (n: number) => string> = {
  recordsOfAsManyLayouts: n => `const things: any[] = [\n${upTo(n, at => `  { shared: ${at}, own${at}: ${at} },`)}\n];`,
  instancesOfAsManyClasses: n =>
    `${upTo(n, at => `class Kind${at} { shared = ${at}; own${at} = ${at}; tell() { return ${at}; } }`)}\nconst things: any[] = [\n${upTo(n, at => `  new Kind${at}(),`)}\n];`,
  asManyClosures: n =>
    `const things: any[] = [\n${upTo(n, at => `  Object.assign(() => ${at}, { shared: ${at}, own${at}: ${at} }),`)}\n];`,
  recordsOfOneLayout: n => `const things: any[] = [\n${upTo(n, at => `  { shared: ${at}, own0: ${at} },`)}\n];`,
};
/** What meets them. Each leaves a number `sum`. */
const users: Record<string, (n: number) => string> = {
  oneFunctionReadsAsManyNames: n =>
    `function read(thing: any): number {\n  let sum = 0;\n${upTo(n, at => `  sum += thing.own${at} ?? 0;`)}\n  return sum;\n}\nlet sum = 0;\nfor (const thing of things) sum += read(thing);`,
  asManyFunctionsReadOneName: n =>
    `${upTo(n, at => `function read${at}(thing: any): number { return thing.shared + ${at}; }`)}\nlet sum = 0;\n${upTo(n, at => `sum += read${at}(things[${at}]);`)}`,
  asManySitesReadOneName: n => `let sum = 0;\n${upTo(n, at => `sum += things[${at}].shared;`)}`,
  oneLoopReadsOneName: () => `let sum = 0;\nfor (const thing of things) sum += thing.shared;`,
  asManyStoresOfNewNames: n =>
    `let sum = 0;\nconst grown: any = {};\n${upTo(n, at => `grown.name${at} = things[${at}];`)}\nsum += Object.keys(grown).length;`,
};
/** Shapes of one kind of thing. The number says how large the small build is against `--size`. */
const whole: Record<string, [number, (n: number) => string]> = {
  aSwitchOfSoManyNumbers: [
    2,
    n =>
      `function pick(x: number): number {\n  switch (x) {\n${upTo(n, at => `    case ${at}: return ${at + 1};`)}\n  }\n  return 0;\n}\nconst sum = pick(JSON.parse("7"));`,
  ],
  aSwitchOfSoManyTexts: [
    2,
    n =>
      `function pick(x: string): number {\n  switch (x) {\n${upTo(n, at => `    case "k${at}": return ${at + 1};`)}\n  }\n  return 0;\n}\nconst sum = pick(JSON.parse('"k7"'));`,
  ],
  aSwitchWhoseCasesFallThrough: [
    2,
    n =>
      `function pick(x: number): number {\n  let seen = 0;\n  switch (x) {\n${upTo(n, at => `    case ${at}: seen += ${at};`)}\n  }\n  return seen;\n}\nconst sum = pick(JSON.parse("${"7"}"));`,
  ],
  aSwitchWhoseLabelsShareOneBody: [
    1,
    n =>
      `function pick(x: number): number {\n  let seen = 0;\n  switch (x) {\n${upTo(n, at => `    case ${at}:`)}\n      seen += 1;\n  }\n  return seen;\n}\nconst sum = pick(JSON.parse("7"));`,
  ],
  twoSwitchesInAChain: [
    5 / 3,
    n =>
      `function pick(c: number): number {\n  let state = 0;\n  switch (c) {\n${upTo(n, at => `    case ${at}: state = ${at}; break;`)}\n  }\n  switch (state) {\n${upTo(n, at => `    case ${at}: return ${at + 1};`)}\n  }\n  return 0;\n}\nconst sum = pick(JSON.parse("7"));`,
  ],
  classesWithALateNameAndMakersOfErrors: [
    5 / 6,
    n =>
      `${upTo(n, at => `class Box${at} { value = ${at}; }`)}\n${upTo(n, at => `function tag${at}(): any { const made: any = new Box${at}(); made.tag = ${at}; return made; }`)}\n${upTo(n, at => `function fail${at}(): any { const made: any = new Error("e${at}"); made.tag = ${at}; return made; }`)}\nlet sum = 0;\n${upTo(n, at => `sum += tag${at}().tag + fail${at}().tag;`)}`,
  ],
  namesHandedOnInALoop: [
    1 / 30,
    n =>
      `function run(turns: number): number {\n  let ${upTo(n, at => `v${at} = 0`, ", ")};\n  for (let i = 0; i < turns; i++) {\n    if (i & 1) {\n${upTo(n - 1, at => `      v${n - 1 - at} = v${n - 2 - at};`)}\n      v0 = i * 0.5;\n    }\n  }\n  return v${n - 1};\n}\nconst sum = run(JSON.parse("9"));`,
  ],
  loopsInsideOneAnother: [
    1 / 12,
    n =>
      `function burrow(limit: number): number {\n  let sum = 0;\n${upTo(n, at => `  while (sum < limit + ${at}) {`)}\n  sum += 1;\n${upTo(n, () => "  }")}\n  return sum;\n}\nconst sum = burrow(JSON.parse("3"));`,
  ],
  classesWithAFieldNextAndLoopsOverLists: [
    1 / 3,
    n =>
      `${upTo(n, at => `class Link${at} { next: Link${at} | null = null; value = ${at}; }`)}\n${upTo(n, at => `function total${at}(list: number[]): number { let s = 0; for (const v of list) s += v; return s + new Link${at}().value; }`)}\nlet sum = 0;\nconst given: number[] = JSON.parse("[1,2,3]");\n${upTo(n, at => `sum += total${at}(given);`)}`,
  ],
  loopsInARowInsideOneLoop: [
    1 / 8,
    n =>
      `function run(turns: number): number {\n  let ${upTo(n, at => `s${at} = 0`, ", ")};\n  for (let t = 0; t < turns; t++) {\n${upTo(n, at => `    for (let i = 0; i < 2; i++) s${at} += 0.5;`)}\n  }\n  return ${upTo(n, at => `s${at}`, " + ")};\n}\nconst sum = run(JSON.parse("3"));`,
  ],
  branchesWithScopesOfTheirOwn: [
    1 / 4,
    n =>
      `const kept: (() => number)[] = [];\nfunction run(x: number): number {\n${upTo(n, at => `  if (x === ${at}) { let held = x + ${at}; kept.push(() => held++); }`)}\n  return kept.length;\n}\nconst sum = run(JSON.parse("7"));`,
  ],
  localsOfOneFunction: [
    1,
    n =>
      `function run(x: number): number {\n${upTo(n, at => `  const v${at} = x + ${at};`)}\n  return ${upTo(Math.min(n, 50), at => `v${at}`, " + ")};\n}\nconst sum = run(JSON.parse("7"));`,
  ],
  callsInARow: [
    1,
    n =>
      `function step(x: number): number { return x + 1; }\nfunction run(x: number): number {\n${upTo(n, () => `  x = step(x);`)}\n  return x;\n}\nconst sum = run(JSON.parse("7"));`,
  ],
};
const shapes = [
  ...Object.keys(makers).flatMap(maker => Object.keys(users).map(user => `${maker}-${user}`)),
  ...Object.keys(whole),
];
const write = (shape: string, n: number) => {
  if (shape in whole) return `${whole[shape][1](Math.round(n * whole[shape][0]))}\nconsole.log(sum);\nexport {};\n`;
  const [maker, user] = shape.split("-");
  return `${makers[maker](n)}\n${users[user](n)}\nconsole.log(sum);\nexport {};\n`;
};

const folder = join(work, `growth-${process.pid}`);
const perf = Bun.which("perf");
/** What a build costs: millions of instructions where `perf` is there, which are the same from run to run, and milliseconds of processor time elsewhere. */
async function costOfBuild(text: string) {
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "program.ts"), text);
  const counted = join(folder, "counted.txt");
  const child = Bun.spawn({
    cmd: [
      ...(perf ? [perf, "stat", "-x,", "-e", "instructions:u", "-o", counted, "--"] : []),
      ...[
        bun,
        "build",
        "--compile",
        "--aot",
        "--aot-threads=1",
        "./program.ts",
        "--outfile",
        join(folder, "executable"),
      ],
    ],
    cwd: folder,
    env: { ...process.env, NO_COLOR: "1" },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    timeout: 900_000,
    killSignal: "SIGKILL",
  });
  if ((await child.exited) !== 0) return NaN;
  if (!perf) return Number(child.resourceUsage()!.cpuTime.total) / 1e3;
  return Number(/^(\d+),,instructions/m.exec(readFileSync(counted, "utf8"))?.[1]) / 1e6;
}

const earlier = new Map<string, number>();
if (options.against && existsSync(options.against))
  for (const line of readFileSync(options.against, "utf8").split("\n")) {
    const [shape, , large] = line.split("\t");
    if (large) earlier.set(shape, Number(large));
  }
const size = Number(options.size);
const table: string[] = [];
const empty = await costOfBuild("console.log(0);\nexport {};\n");
for (const shape of options.shape ? [options.shape] : shapes) {
  const small = await costOfBuild(write(shape, size));
  const large = await costOfBuild(write(shape, size * 4));
  table.push([shape, small.toFixed(0), large.toFixed(0)].join("\t"));
  const before = earlier.get(shape);
  const ratio = (large - empty) / (small - empty);
  const why = !(ratio <= Number(options.most))
    ? `four times the program costs more than ${options.most} times as much, or a build fails`
    : before !== undefined && large > before * Number(options.rise)
      ? `the large build costs ${(large / before).toFixed(2)} times what the earlier table says (${before.toFixed(0)})`
      : "";
  const line = `${shape} | ${small.toFixed(0)} | ${large.toFixed(0)} | x${ratio.toFixed(1)}`;
  console.log(line + (why ? ` | KEPT: ${why}` : ""));
  if (!why) continue;
  mkdirSync(join(finds, `growth-${shape}`), { recursive: true });
  writeFileSync(join(finds, `growth-${shape}`, "program.ts"), write(shape, size));
  writeFileSync(join(finds, `growth-${shape}`, "report.txt"), `growth: ${why}\n${bun}\n${line}\n`);
}
if (options.writes) writeFileSync(options.writes, table.join("\n") + "\n");
rmSync(folder, { recursive: true, force: true });
