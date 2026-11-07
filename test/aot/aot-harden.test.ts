// `bun build --compile --aot` takes --aot-harden=<names>, and Bun.build takes the same names as compile.aotHarden. None is on unless it is asked for.
// proof-checks: what the compiler has proven of a value is tested where the value arrives, and no cell lies in a frame or is handed back.
// What an element is reached through is such a proof: each access reads where the storage lies, how long it is and of which kind, and stops where it was told otherwise.
// ignore-told-ranges: the compiler tells no access that its position lies inside: each tests it where it stands, against the length that it reads there.
// Each is tried against a lie that a word of --aot-testing plants in the compiler: with the name the process stops at the lie and says so. Without it nothing does,
// but for what every build asks: no build believes unasked what comes out of code that the compiler does not see.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withoutCoreDump, withoutCrashReport } from "./harness/commands";
import { run as spawned } from "./harness/run";
import { describe, test } from "./supported";

// The compiler takes whatever code that it does not see answers for undefined.
const falseProof = "--aot-testing=UnseenCodeAnswersUndefined";
const program = `const unseen = new Function("return 7") as () => number;
function kindOf(value: unknown): string {
  return typeof value;
}
function total(): number {
  let sum = 0;
  function add(value: number) {
    sum += value;
  }
  add(1);
  add(2);
  return sum;
}
let sum = 0;
for (let turn = 0; turn < 6; turn++) sum += total();
console.log(kindOf(unseen()), sum);
`;
const printed = "number 18\n";
const stopAtProof =
  /^AOT: f\d+ at \d+:\d+: .+ is not of the type that the compiler has proven of it\. It is: number\./m;

// The compiler takes every index for one that lies inside its list. The store lands behind the last element, inside the room that the list has, and the length stays.
const falseBound = "--aot-testing=PositionsAreTakenToLieInside";
const storeBehindTheEnd = `const list: number[] = [];
for (let i = 0; i < 3; i++) list.push(i + 0.5);
function put(at: number, value: number) {
  if (at >= 0 && at < 5) list[at | 0] = value;
}
put(Number(process.argv.length > 99 ? 0 : 4), 9.5);
console.log(list.length);
`;
const stopAtBound = /^AOT: f\d+ at \d+:\d+: .+ is not of the type that the compiler has proven of it\./m;

const countedLoops = `function sum(values: Float64Array): number {
  let total = 0;
  for (let i = 0; i < values.length; i++) total += values[i];
  return total;
}
function sumOfList(values: number[]): number {
  let total = 0;
  for (let i = 0; i < values.length; i++) total += values[i];
  return total;
}
function spacesIn(text: string): number {
  let spaces = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 32) spaces++;
  return spaces;
}
const values = new Float64Array(1000).fill(1.5);
const list: number[] = [];
for (let i = 0; i < 1000; i++) list.push(i + 0.5);
let total = 0;
for (let turn = 0; turn < 100; turn++) total += sum(values) + sumOfList(list) + spacesIn("a b c " + turn);
console.log(total);
`;

// Short and long lists of each kind of storage: by insertion in place, and by runs in an array of the library's own.
const sorts = `const integers: number[] = [];
const fractions: number[] = [];
const words: string[] = [];
for (let i = 0; i < 300; i++) {
  integers.push((i * 7919) % 311);
  fractions.push(((i * 7919) % 311) + 0.5);
  words.push("w" + ((i * 7919) % 311));
}
const few = [5, 3, 9, 1];
const fewFractions = [5.5, 3.5, 9.5, 1.5];
const withGaps = [3, , 1, undefined, 2];
few.sort((a, b) => a - b);
fewFractions.sort((a, b) => b - a);
integers.sort((a, b) => a - b);
fractions.sort((a, b) => b - a);
words.sort();
withGaps.sort();
console.log(few.join(), fewFractions.join(), integers[0], integers[299], fractions[0], fractions[299], words[0], words[299]);
console.log(withGaps.length, 4 in withGaps, withGaps.join(), integers.toSorted((a, b) => b - a)[0], [].sort().length, [1].sort()[0]);
`;

// The name of the executable that --outfile built writes.
const built = isWindows ? "built.exe" : "built";

const commandLine = (flags: string[]) => [
  bunExe(),
  "build",
  "--compile",
  "--aot",
  ...flags,
  "program.ts",
  "--outfile",
  "built",
];

async function build(cwd: string, flags: string[]) {
  const { stdout, stderr, exitCode } = await spawned(commandLine(flags), cwd);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
  return stdout + stderr;
}

const runBuilt = (cwd: string) =>
  spawned(withoutCoreDump([join(cwd, built)]), cwd, { ...bunEnv, ...withoutCrashReport });

const runPlain = (cwd: string) => spawned([bunExe(), "program.ts"], cwd, bunEnv);

// Each name stands once among what --explain=statistics prints, whatever its number is.
async function countsOf(source: string, flags: string[]) {
  using folder = tempDir("aot-harden", { "program.ts": source });
  const said = await build(String(folder), ["--explain=statistics", ...flags]);
  const names = ["AllocateInFramesChanges", "ClosuresInFrames", "RangeChecksRemoved", "KnownInductionsUsed"] as const;
  return Object.fromEntries(
    names.map(name => {
      const lines = Array.from(said.matchAll(new RegExp(`^${name} (\\d+)$`, "gm")), ([, count]) => Number(count));
      expect({ name, lines: lines.length }).toEqual({ name, lines: 1 });
      return [name, lines[0]];
    }),
  ) as Record<(typeof names)[number], number>;
}

describe.concurrent("--aot-harden=proof-checks", () => {
  test("stops the program at a proof that is false", async () => {
    using folder = tempDir("aot-harden", { "program.ts": program });
    await build(String(folder), ["--aot-harden=proof-checks", falseProof]);
    const { stdout, stderr, exitCode } = await runBuilt(String(folder));
    expect(stderr).toMatch(stopAtProof);
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
  }, 120_000);

  test("leaves alone a program whose proofs hold", async () => {
    using folder = tempDir("aot-harden", { "program.ts": program });
    await build(String(folder), ["--aot-harden=proof-checks"]);
    const { stdout, stderr, exitCode } = await runBuilt(String(folder));
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: printed, stderr: "", exitCode: 0 });
  }, 120_000);

  test("what unseen code answers is asked in every build, so that lie is met without it too", async () => {
    using folder = tempDir("aot-harden", { "program.ts": program });
    await build(String(folder), [falseProof]);
    const { stdout, stderr, exitCode } = await runBuilt(String(folder));
    expect(stderr).toMatch(stopAtProof);
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
  }, 120_000);

  test("leaves every cell to the collector", async () => {
    // The scope of total() is handed back at its end and taken again by the next call.
    expect((await countsOf(program, [])).AllocateInFramesChanges).toBeGreaterThan(0);
    expect(await countsOf(program, ["--aot-harden=proof-checks"])).toMatchObject({
      AllocateInFramesChanges: 0,
      ClosuresInFrames: 0,
    });
  }, 120_000);

  test("stops the program at a bound that is false", async () => {
    using folder = tempDir("aot-harden", { "program.ts": storeBehindTheEnd });
    await build(String(folder), ["--aot-harden=proof-checks", falseBound]);
    const { stdout, stderr, exitCode } = await runBuilt(String(folder));
    expect(stderr).toMatch(stopAtBound);
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
  }, 120_000);

  test("leaves no access without its test", async () => {
    expect((await countsOf(countedLoops, [])).RangeChecksRemoved).toBeGreaterThan(0);
    expect((await countsOf(countedLoops, ["--aot-harden=proof-checks"])).RangeChecksRemoved).toBe(0);
  }, 120_000);

  test("gives the same answers in loops over lists, views and texts", async () => {
    using hardened = tempDir("aot-harden", { "program.ts": countedLoops });
    await build(String(hardened), ["--aot-harden=proof-checks"]);
    const expected = await runPlain(String(hardened));
    expect(expected.exitCode).toBe(0);
    expect(await runBuilt(String(hardened))).toEqual(expected);
  }, 120_000);

  test("stops at no position that the library's sort hands over", async () => {
    using hardened = tempDir("aot-harden", { "program.ts": sorts });
    await build(String(hardened), ["--aot-harden=proof-checks"]);
    expect(await runBuilt(String(hardened))).toEqual({
      stdout: "1,3,5,9 9.5,5.5,3.5,1.5 0 310 310.5 0.5 w0 w99\n5 false 1,2,3,, 310 0 1\n",
      stderr: "",
      exitCode: 0,
    });
  }, 120_000);

  test("says which words of the compiler it stands for", async () => {
    using folder = tempDir("aot-harden", { "program.ts": program });
    expect(await build(String(folder), ["--aot-harden=proof-checks"])).toContain(
      "Built with developer options: --aot-testing=CheckProofsAtRunTime --aot-testing=KeepsCellsOutOfFrames\n",
    );
  }, 120_000);
});

describe.concurrent("--aot-harden=ignore-told-ranges", () => {
  test("stops the program at a bound that is false", async () => {
    using folder = tempDir("aot-harden", { "program.ts": storeBehindTheEnd });
    await build(String(folder), ["--aot-harden=ignore-told-ranges", falseBound]);
    const { stdout, stderr, exitCode } = await runBuilt(String(folder));
    expect(stderr).toMatch(stopAtBound);
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
  }, 120_000);

  test("leaves alone a program whose bounds hold", async () => {
    using folder = tempDir("aot-harden", { "program.ts": storeBehindTheEnd });
    await build(String(folder), ["--aot-harden=ignore-told-ranges"]);
    const { stdout, stderr, exitCode } = await runBuilt(String(folder));
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "5\n", stderr: "", exitCode: 0 });
  }, 120_000);

  test("is not on without being asked for", async () => {
    using folder = tempDir("aot-harden", { "program.ts": storeBehindTheEnd });
    await build(String(folder), [falseBound]);
    const { stdout, stderr, exitCode } = await runBuilt(String(folder));
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "3\n", stderr: "", exitCode: 0 });
  }, 120_000);

  test("leaves no access without its test, in the loops that a plain build has", async () => {
    const { KnownInductionsUsed } = await countsOf(countedLoops, []);
    expect(KnownInductionsUsed).toBeGreaterThan(0);
    const hardened = { AllocateInFramesChanges: 0, ClosuresInFrames: 0, RangeChecksRemoved: 0, KnownInductionsUsed };
    expect(await countsOf(countedLoops, ["--aot-harden=proof-checks,ignore-told-ranges"])).toEqual(hardened);
    expect(await countsOf(countedLoops, ["--aot-harden=ignore-told-ranges", "--aot-harden=proof-checks"])).toEqual(
      hardened,
    );
  }, 120_000);

  test("gives the same answers", async () => {
    using hardened = tempDir("aot-harden", { "program.ts": countedLoops });
    await build(String(hardened), ["--aot-harden=proof-checks,ignore-told-ranges"]);
    const expected = await runPlain(String(hardened));
    expect(expected.exitCode).toBe(0);
    expect(await runBuilt(String(hardened))).toEqual(expected);
  }, 120_000);

  test("stops at no position that the library's sort hands over", async () => {
    using hardened = tempDir("aot-harden", { "program.ts": sorts });
    await build(String(hardened), ["--aot-harden=proof-checks,ignore-told-ranges"]);
    expect(await runBuilt(String(hardened))).toEqual({
      stdout: "1,3,5,9 9.5,5.5,3.5,1.5 0 310 310.5 0.5 w0 w99\n5 false 1,2,3,, 310 0 1\n",
      stderr: "",
      exitCode: 0,
    });
  }, 120_000);
});

describe.concurrent("compile.aotHarden", () => {
  async function buildByCall(folder: string, members: string) {
    writeFileSync(
      join(folder, "build.ts"),
      `try {
  await Bun.build({ entrypoints: ["./program.ts"], compile: { outfile: "./built", aot: true, ${members} } as any });
} catch (error) {
  console.log((error as Error).message);
}
`,
    );
    return spawned([bunExe(), "build.ts"], folder);
  }

  const hashOf = (path: string) => new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex");

  test.each([
    ["a name in a list", `aotHarden: ["proof-checks"]`],
    ["a name as a string", `aotHarden: "proof-checks"`],
  ])(
    "builds what the command line builds from %s",
    async (_, members) => {
      using byCommand = tempDir("aot-harden", { "program.ts": program });
      using byCall = tempDir("aot-harden", { "program.ts": program });
      using byDefault = tempDir("aot-harden", { "program.ts": program });
      await build(String(byCommand), ["--aot-harden=proof-checks"]);
      await build(String(byDefault), []);
      const { stdout, exitCode } = await buildByCall(String(byCall), members);
      expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 0 });
      const hashByCall = hashOf(join(String(byCall), built));
      expect(hashByCall).toBe(hashOf(join(String(byCommand), built)));
      expect(hashByCall).not.toBe(hashOf(join(String(byDefault), built)));
    },
    120_000,
  );

  test("takes the two names as the command line does", async () => {
    using byCommand = tempDir("aot-harden", { "program.ts": program });
    using byCall = tempDir("aot-harden", { "program.ts": program });
    await build(String(byCommand), ["--aot-harden=proof-checks,ignore-told-ranges"]);
    const { stdout, exitCode } = await buildByCall(String(byCall), `aotHarden: ["proof-checks", "ignore-told-ranges"]`);
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 0 });
    expect(hashOf(join(String(byCall), built))).toBe(hashOf(join(String(byCommand), built)));
  }, 120_000);

  test.each([
    [`["nonsense"]`, "nonsense"],
    [`"proof-checks,nonsense"`, "nonsense"],
    [`"proof-checks,"`, ""],
  ])(
    "throws on a name that it doesn't know: %s",
    async (value, name) => {
      using folder = tempDir("aot-harden", { "program.ts": program });
      const { stdout } = await buildByCall(String(folder), `aotHarden: ${value}`);
      expect(stdout).toContain(
        `Invalid value for compile.aotHarden: "${name}". Must be a list of these names: proof-checks, ignore-told-ranges`,
      );
    },
    120_000,
  );

  test.each([["[7]"], ["7"]])(
    "throws on what isn't a name: %s",
    async value => {
      using folder = tempDir("aot-harden", { "program.ts": program });
      const { stdout } = await buildByCall(String(folder), `aotHarden: ${value}`);
      expect(stdout).toStartWith(`The "compile.aotHarden" property must be of type string or array of strings`);
    },
    120_000,
  );

  test("requires compile.aot", async () => {
    using folder = tempDir("aot-harden", { "program.ts": program });
    writeFileSync(
      join(String(folder), "build.ts"),
      `try {
  await Bun.build({ entrypoints: ["./program.ts"], compile: { outfile: "./built", aotHarden: "proof-checks" } as any });
} catch (error) {
  console.log((error as Error).message);
}
`,
    );
    const { stdout } = await spawned([bunExe(), "build.ts"], String(folder));
    expect(stdout).toContain("compile.aotHarden requires compile.aot: true");
  }, 120_000);
});

test.concurrent(
  "--aot-harden refuses a name that it doesn't know",
  async () => {
    using folder = tempDir("aot-harden", { "program.ts": program });
    const { stderr, exitCode } = await spawned(commandLine(["--aot-harden=nonsense"]), String(folder));
    expect(stderr).toContain(
      `Invalid value for --aot-harden: "nonsense". Must be a list of these names: proof-checks, ignore-told-ranges`,
    );
    expect(exitCode).not.toBe(0);
  },
  120_000,
);

test.concurrent(
  "--aot-harden requires --aot",
  async () => {
    using folder = tempDir("aot-harden", { "program.ts": program });
    const { stderr, exitCode } = await spawned(
      [bunExe(), "build", "--compile", "--aot-harden=proof-checks", "program.ts", "--outfile", "built"],
      String(folder),
    );
    expect(stderr).toContain("--aot-harden requires --aot");
    expect(exitCode).not.toBe(0);
  },
  120_000,
);
