// `bun build --compile --aot` takes --aot-disable=<names> and --aot-heat=<word>. Bun.build takes the same words as compile.aotDisable and compile.aotHeat.
// One function reads both spellings, so the same words give the same executable, byte for byte, and a word that the one rejects the other rejects with the same sentence.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canTrim } from "../bundler/compile-trim-features";
import { unsupported } from "./harness/compiler";
import { run } from "./harness/run";
import { inTurn } from "./harness/shared-builds";
import { copyWithoutDebugInformation, withoutDebugInformation } from "./harness/without-debug-information";

const files = {
  "app.ts": `class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
}
function sum(points: Point[], weigh: (point: Point) => number) {
  let total = 0;
  for (const point of points) total += weigh(point);
  return total;
}
const points: Point[] = [];
for (let i = 0; i < 100; i++) points.push(new Point(i, i + 1));
console.log(sum(points, point => point.x * point.y));
`,
};
const printed = "333300\n";

// The name of the executable is in the executable.
const executableIn = (folder: string) => join(folder, isWindows ? "app.exe" : "app");
const hashOf = (path: string) => new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex");

const dir = tempDir("aot-disable-and-aot-heat", files);
afterAll(() => dir[Symbol.dispose]());
const root = String(dir);
let folders = 0;

function makeFolder() {
  const label = `build-${folders++}`;
  mkdirSync(join(root, label));
  return { label, folder: join(root, label) };
}

const builtByCommand = new Map<string, ReturnType<typeof buildAnew>>();
async function buildAnew(flags: string[]) {
  const { folder } = makeFolder();
  const built = await inTurn(() =>
    run(
      [
        bunExe(),
        "build",
        "--compile",
        ...flags,
        ...withoutDebugInformation,
        "app.ts",
        "--outfile",
        join(folder, "app"),
      ],
      root,
    ),
  );
  return { ...built, executable: executableIn(folder) };
}
/** Once for each list of flags. */
const buildByCommand = (flags: string[]) => builtByCommand.getOrInsertComputed(flags.join(" "), () => buildAnew(flags));

/** `members`: the text of further members of `compile`. */
async function buildByCall(members: string) {
  const { label, folder } = makeFolder();
  const executablePath = copyWithoutDebugInformation
    ? `executablePath: ${JSON.stringify(copyWithoutDebugInformation)}, `
    : "";
  writeFileSync(
    join(folder, "build.ts"),
    `try {
  await Bun.build({ entrypoints: ["./app.ts"], compile: { outfile: "./${label}/app", ${executablePath}${members} } as any });
} catch (error) {
  console.log((error as Error).message);
}
`,
  );
  const { stdout, stderr, exitCode } = await inTurn(() => run([bunExe(), join(folder, "build.ts")], root));
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return { message: stdout, executable: executableIn(folder) };
}

const accepted: [title: string, flags: string[], members: string, changesTheCode: boolean][] = [
  ["one name in a list", ["--aot-disable=flow-results"], `aotDisable: ["flow-results"]`, true],
  ["one name as a string", ["--aot-disable=flow-results"], `aotDisable: "flow-results"`, true],
  [
    "two names in a list",
    ["--aot-disable=pass:InlineCalls", "--aot-disable=flow:CalleeSets"],
    `aotDisable: ["pass:InlineCalls", "flow:CalleeSets"]`,
    true,
  ],
  [
    "two names in a string, with a comma between them",
    ["--aot-disable=pass:InlineCalls,flow:CalleeSets"],
    `aotDisable: "pass:InlineCalls,flow:CalleeSets"`,
    true,
  ],
  ["a word for the heat", ["--aot-heat=everything-is-cold"], `aotHeat: "everything-is-cold"`, true],
  [
    "both options",
    ["--aot-disable=flow-results", "--aot-heat=everything-is-cold"],
    `aotDisable: ["flow-results"], aotHeat: "everything-is-cold"`,
    true,
  ],
  ["an empty list and null", [], `aotDisable: [], aotHeat: null`, false],
  ["null and undefined", [], `aotDisable: null, aotHeat: undefined`, false],
];

const rejected: [flags: string[], members: string, flag: string, option: string, sentence: string][] = [
  [
    ["--aot-disable=nonsense"],
    `aotDisable: ["nonsense"]`,
    "--aot-disable=nonsense",
    "compile.aotDisable",
    "unknown switch nonsense",
  ],
  [
    ["--aot-disable=flow-results", "--aot-disable=pass:Nonsense"],
    `aotDisable: ["flow-results", "pass:Nonsense"]`,
    "--aot-disable=pass:Nonsense",
    "compile.aotDisable",
    "unknown switch pass:Nonsense",
  ],
  [
    ["--aot-disable=flow-results,nonsense"],
    `aotDisable: "flow-results,nonsense"`,
    "--aot-disable=flow-results,nonsense",
    "compile.aotDisable",
    "unknown switch nonsense",
  ],
  [
    ["--aot-disable=flow-results,"],
    `aotDisable: ["flow-results,"]`,
    "--aot-disable=flow-results,",
    "compile.aotDisable",
    "empty name in disable=flow-results,",
  ],
  [
    ["--aot-disable=pass:VerifyProgram"],
    `aotDisable: ["pass:VerifyProgram"]`,
    "--aot-disable=pass:VerifyProgram",
    "compile.aotDisable",
    "pass:VerifyProgram is required and cannot be disabled",
  ],
  [
    ["--aot-heat=lukewarm"],
    `aotHeat: "lukewarm"`,
    "--aot-heat=lukewarm",
    "compile.aotHeat",
    "unknown heat override lukewarm",
  ],
  [
    ["--aot-disable=flow-results", "--aot-heat=lukewarm"],
    `aotDisable: ["flow-results"], aotHeat: "lukewarm"`,
    "--aot-heat=lukewarm",
    "compile.aotHeat",
    "unknown heat override lukewarm",
  ],
];

describe.skipIf(!!unsupported)("Bun.build", () => {
  test.concurrent.each(accepted)(
    "builds what the command line builds: %s",
    async (_, flags, members, changesTheCode) => {
      const [byDefault, byCommand, byCall] = await Promise.all([
        buildByCommand(["--aot"]),
        buildByCommand(["--aot", ...flags]),
        buildByCall(`aot: true, ${members}`),
      ]);
      expect({ exitCode: byCommand.exitCode, message: byCall.message }).toEqual({ exitCode: 0, message: "" });
      expect(hashOf(byCall.executable)).toBe(hashOf(byCommand.executable));
      expect(hashOf(byCall.executable) !== hashOf(byDefault.executable)).toBe(changesTheCode);
      expect(await run([byCall.executable], root)).toEqual({ stdout: printed, stderr: "", exitCode: 0 });
    },
  );

  test.concurrent.each(rejected)(
    "rejects what the command line rejects: %j",
    async (flags, members, flag, option, sentence) => {
      const byCommand = await buildByCommand(["--aot", ...flags]);
      expect({ stdout: byCommand.stdout, stderr: byCommand.stderr, exitCode: byCommand.exitCode }).toEqual({
        stdout: "",
        stderr: `error: ${flag}: ${sentence}\n`,
        exitCode: 1,
      });
      const byCall = await buildByCall(`aot: true, ${members}`);
      expect(byCall.message).toBe(`${option}: ${sentence}\n`);
      expect([byCommand.executable, byCall.executable].filter(existsSync)).toEqual([]);
    },
  );

  test.concurrent.each([
    [["--aot-disable=flow-results"], `aotDisable: ["flow-results"]`, "--aot-disable", "compile.aotDisable"],
    [["--aot-heat=everything-is-cold"], `aotHeat: "everything-is-cold"`, "--aot-heat", "compile.aotHeat"],
    [
      ["--aot-heat=everything-is-cold", "--aot-disable=flow-results"],
      `aotHeat: "everything-is-cold", aotDisable: ["flow-results"]`,
      "--aot-disable",
      "compile.aotDisable",
    ],
  ] as [string[], string, string, string][])("without aot, rejects %j", async (flags, members, flag, option) => {
    const byCommand = await buildByCommand(flags);
    expect({ stdout: byCommand.stdout, stderr: byCommand.stderr, exitCode: byCommand.exitCode }).toEqual({
      stdout: "",
      stderr: `error: ${flag} requires --aot\n`,
      exitCode: 1,
    });
    for (const aot of ["", "aot: false, "]) {
      const byCall = await buildByCall(aot + members);
      expect(byCall.message).toBe(`${option} requires compile.aot: true\n`);
      expect(existsSync(byCall.executable)).toBe(false);
    }
    expect(existsSync(byCommand.executable)).toBe(false);
  });

  test.concurrent.each([
    [`aotDisable: 1`, "compile.aotDisable", "string or array of strings"],
    [`aotDisable: true`, "compile.aotDisable", "string or array of strings"],
    [`aotDisable: ["flow-results", 1]`, "compile.aotDisable", "string or array of strings"],
    [`aotDisable: [["flow-results"]]`, "compile.aotDisable", "string or array of strings"],
    [`aotDisable: { name: "flow-results" }`, "compile.aotDisable", "string or array of strings"],
    [`aotHeat: 1`, "compile.aotHeat", "string"],
    [`aotHeat: ["everything-is-cold"]`, "compile.aotHeat", "string"],
  ])("rejects a value of another type: %s", async (members, option, type) => {
    const byCall = await buildByCall(`aot: true, ${members}`);
    expect(byCall.message).toStartWith(`The "${option}" property must be of type ${type}`);
    expect(existsSync(byCall.executable)).toBe(false);
  });

  test.concurrent("takes every word that its type lists for aotHeat, and each gives another executable", async () => {
    const types = readFileSync(join(import.meta.dir, "..", "..", "packages", "bun-types", "bun.d.ts"), "utf8");
    const words = Array.from(/type AotHeat =([^;]+);/.exec(types)![1].matchAll(/"([^"]+)"/g), match => match[1]);
    expect(words).toContain("everything-is-cold");
    const built = await Promise.all(words.map(word => buildByCall(`aot: true, aotHeat: "${word}"`)));
    expect(built.map(({ message }) => message)).toEqual(words.map(() => ""));
    expect(new Set(built.map(({ executable }) => hashOf(executable))).size).toBe(words.length);
    for (const { executable } of built)
      expect(await run([executable], root)).toEqual({ stdout: printed, stderr: "", exitCode: 0 });
  });
});

test.skipIf(!canTrim || !!unsupported)(
  "an executable that has no compiler says so, whatever the words are",
  async () => {
    using dir = tempDir("aot-disable-and-aot-heat", {
      ...files,
      "builds.ts": `const folder = process.env.FOLDER;
for (const words of [{ aotDisable: ["flow-results"] }, { aotHeat: "everything-is-cold" }, { aotDisable: ["nonsense"] }]) {
  try {
    await Bun.build({ entrypoints: [folder + "/app.ts"], compile: { aot: true, outfile: folder + "/app", ...words } as any });
    console.log("built");
  } catch (error) {
    console.log(((error as AggregateError).errors?.[0] ?? (error as Error)).message);
  }
}
`,
    });
    const root = String(dir);
    const build = [bunExe(), "build", "--compile", "--trim", "builds.ts", "--outfile", "builds"];
    expect(await run(build, root)).toMatchObject({ exitCode: 0 });
    expect(await run([join(root, "builds")], root, { ...bunEnv, FOLDER: root })).toEqual({
      stdout: "compile.aot isn't available in this build of Bun\n".repeat(3),
      stderr: "",
      exitCode: 0,
    });
  },
  600_000,
);
