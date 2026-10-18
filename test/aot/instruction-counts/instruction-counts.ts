import { afterAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { unsupported, withoutDebugInformation } from "../run-programs";
import {
  mark,
  whyInstructionsCannotBeCounted,
  type CompiledFunction,
  type Counted,
  type Request,
} from "./count-instructions";

const snippets = join(import.meta.dir, "snippets");
const programs = join(import.meta.dir, "programs");
const packages = join(import.meta.dir, "packages");
const inPlace = join(import.meta.dir, "in-place");
const folderOfCountedPrograms = process.platform === "linux" ? "/tmp" : realpathSync(tmpdir());
const turnsBeforeCounting = [50, 50, 50, 50],
  fewerTurns = 100,
  moreTurns = 300;
const roundsBeforeCounting = [1, 1, 1, 1],
  roundsOfFewerOperations = 1,
  roundsOfMoreOperations = 3;

type Door = { name: string; label: string; setup: string; costsNoMoreThan?: string; notYetIn?: string[] };
type Form = { types: "typed" | "untyped"; place: "function" | "module level" | "function that no loop calls"; door?: Door; heat?: Heat };
const forms: Form[] = [
  { types: "typed", place: "function" },
  { types: "typed", place: "module level" },
  { types: "untyped", place: "function" },
  { types: "untyped", place: "module level" },
];
const formsOutsideLoops: Form[] = [
  { types: "typed", place: "function" },
  { types: "typed", place: "function that no loop calls" },
  { types: "untyped", place: "function" },
  { types: "untyped", place: "function that no loop calls" },
];

type Heat = "outside the hottest functions" | "as built";
const optionsOf: Record<Heat, Record<string, string>> = {
  "outside the hottest functions": { BUN_JSC_aotHotByTextForTesting: "4" },
  "as built": {},
};

function partsOf(name: string, text: string) {
  const parts = /^\/\/ (.*)\n([^]*?)\nkernel: \{\n([^]*?)\n\}\n([^]*)$/.exec(text);
  const operations = /^const operations = (\d+);$/m.exec(text);
  if (!parts || !operations)
    throw new Error(
      `${name} needs a first line that says what it is, "const operations = <number>;" and a block labeled "kernel"`,
    );
  return { title: parts[1], setup: parts[2], kernel: parts[3], rest: parts[4], operations: Number(operations[1]) };
}

function isCountedTwice(operations: number) {
  return operations * (roundsOfMoreOperations - roundsOfFewerOperations) < 10;
}

function programOf({ setup, kernel, rest, operations }: ReturnType<typeof partsOf>, place: Form["place"]) {
  const waits = /\bawait\b/.test(kernel);
  const windows = (turn: string) =>
    `const roundsOfWindows = process.argv.slice(2).map(Number);\n${isCountedTwice(operations) ? "roundsOfWindows.push(...roundsOfWindows.slice(-2));\n" : ""}for (let window = 0; window < roundsOfWindows.length; window++) {\n  const rounds = roundsOfWindows[window];\n  for (let round = 0; round < rounds; round++) ${turn}\n  ${mark}\n}\n`;
  if (place === "module level") return `${setup}\n${windows(`{\n${kernel}\n  }`)}${rest}`;
  return `${setup}
let isNeverThrown = 0;
if (process.argv.length > 50) isNeverThrown = 1;
${waits ? "async " : ""}function kernel() {
  try {
    if (isNeverThrown > 0) throw isNeverThrown;
  } catch {
    return;
  }
${kernel}
}
${
  place === "function that no loop calls"
    ? `function neverCalled() {}\nfunction chosen() {\n  return process.argv.length > 50 ? neverCalled : kernel;\n}\nconst called = chosen();\n${windows(`{\n    ${waits ? "await " : ""}called();\n  }`)}`
    : windows(`{\n    ${waits ? "await " : ""}kernel();\n    if (rounds < 0) ${waits ? "await " : ""}kernel();\n  }`)
}${rest}`;
}

async function run(command: string[], cwd: string, env: Record<string, string | undefined>) {
  await using child = Bun.spawn({ cmd: command, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, stderr, exitCode };
}

function functionsOf(map: string, entry: string): CompiledFunction[] {
  const functions: CompiledFunction[] = [];
  for (const line of map.split("\n")) {
    const fields = line.split("\t");
    if (fields[0] === "F")
      functions.push({
        offset: Number(fields[2]),
        size: Number(fields[3]),
        name:
          fields[10] === entry || fields[7].startsWith("module ")
            ? fields[7] || "a function without a name"
            : "built-in modules",
      });
    else if (fields[0] === "T")
      functions.push({
        offset: Number(fields[1]),
        size: -1,
        name: fields[2].startsWith("outlined ") ? "outlined code" : `stub ${fields[2]}`,
      });
  }
  functions.sort((a, b) => a.offset - b.offset);
  functions.forEach((compiled, index) => {
    if (compiled.size < 0) compiled.size = (functions[index + 1]?.offset ?? compiled.offset) - compiled.offset;
  });
  return functions;
}

const bytesOfNearCall = process.arch === "arm64" ? 4 : 5;

/**
 * The outliner replaces a run of instructions that the whole program repeats often enough with a call. How often depends on which of
 * Bun's own modules are in the program, so a function is measured as the compiler made it: a P line of the map lists what was taken out.
 */
function bytesBeforeOutlining(map: string, entry: string, name: string) {
  const measured = new Set<string>();
  let bytes = 0;
  for (const line of map.split("\n")) {
    const fields = line.split("\t");
    if (fields[0] === "F" && fields[7] === name && (fields[10] === entry || name.startsWith("module "))) {
      measured.add(fields[1]);
      bytes += Number(fields[3]);
    } else if (fields[0] === "P" && measured.has(fields[1])) {
      for (let length = 3; length < fields.length; length += 3) bytes += Number(fields[length]) - bytesOfNearCall;
    }
  }
  return bytes;
}

async function countInstructions(request: Request): Promise<Counted> {
  await using child = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "count-in-a-child.ts")],
    env: bunEnv,
    stdin: new Blob([JSON.stringify(request)]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  if (exitCode) throw new Error(stderr.trim());
  const counted = JSON.parse(stdout);
  return { ...counted, windows: counted.windows.map((window: [string, number][]) => new Map(window)) };
}

const atOnce = Math.max(1, Number(process.env.AOT_PROGRAMS_JOBS) || availableParallelism());
const jobs: (() => Promise<string[]>)[] = [];
const started: Promise<string[]>[] = [];

function linesOf(job: () => Promise<string[]>) {
  const index = jobs.push(job) - 1;
  return () => {
    for (let next = index; next < Math.min(jobs.length, index + atOnce); next++)
      if (!started[next]) (started[next] = jobs[next]()).catch(() => {});
    return started[index];
  };
}

const tsconfigWithTypesOfBun = JSON.stringify({
  compilerOptions: { typeRoots: [join(import.meta.dir, "..", "..", "..", "packages")], types: ["bun-types"] },
});

const twoDecimals = (value: number) => value.toFixed(2).replace(/\.00$/, "");

async function lineOf(
  name: string,
  parts: ReturnType<typeof partsOf>,
  form: Form,
  dir: string,
  countsInstructions: boolean,
  heat: Heat,
) {
  const stem = `${name}.${form.door ? `${form.door.name}.` : ""}${form.types}.${form.place.replaceAll(" ", "-")}${form.heat ? `.${form.heat.replaceAll(" ", "-")}` : ""}`;
  writeFileSync(join(dir, "tsconfig.json"), tsconfigWithTypesOfBun);
  writeFileSync(join(dir, `${stem}.ts`), programOf(form.door ? { ...parts, setup: `${form.door.setup}\n${parts.setup}` } : parts, form.place));
  let entry = `${stem}.ts`;
  if (form.types === "untyped") {
    const erased = await run([bunExe(), "build", "--no-bundle", entry], dir, bunEnv);
    expect({ stderr: erased.stderr, exitCode: erased.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    rmSync(join(dir, entry));
    entry = `${stem}.js`;
    writeFileSync(join(dir, entry), erased.stdout);
  }
  const executable = join(dir, stem),
    mapFile = join(dir, `${stem}.map`);
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", ...withoutDebugInformation(), entry, "--outfile", executable],
    dir,
    { ...bunEnv, BUN_JSC_aotMapFilePath: mapFile, ...optionsOf[form.heat ?? heat] },
  );
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const map = readFileSync(mapFile, "utf8");
  const functions = functionsOf(map, entry);
  const bytes = bytesBeforeOutlining(map, entry, form.place === "module level" ? `module ${entry}` : "kernel");
  const label = `${form.door?.label ?? `${form.types}, ${form.place}`}${form.heat ? `, ${form.heat}` : ""}`;
  if (!countsInstructions) return `${label}: ${bytes} bytes`;

  const counted = await countInstructions({
    command: [executable, ...[...roundsBeforeCounting, roundsOfFewerOperations, roundsOfMoreOperations].map(String)],
    env: { ...bunEnv, BUN_JSC_useGC: "0", BUN_JSC_crashIfInterpreterIsUsed: "1" },
    marksBeforeTheFirstWindow: roundsBeforeCounting.length,
    numberOfWindows: isCountedTwice(parts.operations) ? 4 : 2,
    functions,
  });
  expect({ stderr: counted.stderr, exitCode: counted.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const operations = parts.operations * (roundsOfMoreOperations - roundsOfFewerOperations);
  const shares = sharesOf(
    [cheapest(counted.windows.filter((_, index) => index % 2 === 0)), cheapest(counted.windows.filter((_, index) => index % 2 === 1))],
    operations,
    entry,
  );
  if (form.place !== "module level") expect(shares.map(share => share.where)).toContain("kernel");
  return `${label}: ${shown(shares)}, ${bytes} bytes`;
}

type Share = { where: string; instructions: number };

function cheapest(windows: Map<string, number>[]) {
  const total = (window: Map<string, number>) => [...window.values()].reduce((sum, instructions) => sum + instructions, 0);
  return windows.reduce((best, window) => (total(window) < total(best) ? window : best));
}

function sharesOf([few, many]: Map<string, number>[], operations: number, entry: string): Share[] {
  return [...new Set([...few.keys(), ...many.keys()])]
    .map(where => ({
      where: where === `module ${entry}` ? "module" : where,
      instructions: ((many.get(where) ?? 0) - (few.get(where) ?? 0)) / operations,
    }))
    .filter(share => Math.abs(share.instructions) >= 0.005)
    .sort((a, b) => b.instructions - a.instructions || (a.where < b.where ? -1 : 1));
}

function shown(shares: Share[]) {
  const all = shares.reduce((sum, share) => sum + share.instructions, 0);
  return `${twoDecimals(all)} instructions (${shares.map(share => `${share.where} ${twoDecimals(share.instructions)}`).join(", ")})`;
}

function describeCasesOf(folder: string, platform: string, isSkipped: boolean, testFile = `${platform}-programs`) {
  const title = /^\/\/ (.*)\n/.exec(readFileSync(join(folder, "main.ts"), "utf8"))?.[1];
  if (!title) throw new Error(`${folder}/main.ts needs a first line that says what it is`);
  const names = Bun.spawnSync({ cmd: [bunExe(), join(folder, "main.ts"), "names"], env: bunEnv });
  const dir = mkdtempSync(join(folderOfCountedPrograms, `instruction-counts-${basename(folder)}_`));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const executable = join(dir, "main"),
    mapFile = join(dir, "main.map");
  const turns: { before: number[]; fewer: number; more: number } = existsSync(join(folder, "turns.json"))
    ? JSON.parse(readFileSync(join(folder, "turns.json"), "utf8"))
    : { before: turnsBeforeCounting, fewer: fewerTurns, more: moreTurns };
  let functions: Promise<CompiledFunction[]> | undefined;
  const build = async () => {
    cpSync(folder, dir, { recursive: true });
    if (!existsSync(join(dir, "tsconfig.json"))) writeFileSync(join(dir, "tsconfig.json"), tsconfigWithTypesOfBun);
    if (existsSync(join(dir, "package.json"))) {
      const installed = process.env.BUN_TEST_AOT_COUNTED_PACKAGES;
      const got = installed
        ? await run(["cp", "-R", join(installed, basename(folder), "node_modules"), "node_modules"], dir, bunEnv)
        : await run([bunExe(), "install", "--ignore-scripts", "--frozen-lockfile"], dir, bunEnv);
      expect({ stderr: got.exitCode ? got.stderr : "", exitCode: got.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    }
    const flags: string[] = existsSync(join(dir, "flags.json")) ? JSON.parse(readFileSync(join(dir, "flags.json"), "utf8")) : [];
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", ...withoutDebugInformation(), "main.ts", ...flags, "--outfile", executable],
      dir,
      { ...bunEnv, BUN_JSC_aotMapFilePath: mapFile, BUN_JSC_aotHotByTextForTesting: "4" },
    );
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    return functionsOf(readFileSync(mapFile, "utf8"), "main.ts");
  };
  for (const name of names.stdout.toString().split("\n").filter(Boolean)) {
    const lines = linesOf(async () => {
      const counted = await countInstructions({
        command: [executable, name, ...[...turns.before, turns.fewer, turns.more].map(String)],
        env: { ...bunEnv, BUN_JSC_useGC: "0" },
        marksBeforeTheFirstWindow: turns.before.length,
        numberOfWindows: 2,
        functions: await (functions ??= build()),
      });
      expect({ stderr: counted.stderr, exitCode: counted.exitCode }).toEqual({ stderr: "", exitCode: 0 });
      return [`a turn: ${shown(sharesOf(counted.windows, turns.more - turns.fewer, "main.ts"))}, 0 bytes`];
    });
    test.skipIf(isSkipped)(
      `${title}: ${name}`,
      async () => {
        const [line] = await lines();
        const before = recordedLines(testFile, `${title}: ${name}`)[0];
        expect(before !== undefined && isNoWorse(line, before, turns.more - turns.fewer) ? before : line).toMatchSnapshot();
      },
      600_000,
    );
  }
}

const shareOutsideCompiledCode = /^(the runtime|elsewhere)$/;

const instructionsOfTwoBlockRefills = 5_000;

function numbersOf(line: string) {
  const found = /^(.+): (-?[\d.]+) instructions \((.*)\), (\d+) bytes$/.exec(line);
  if (!found) return undefined;
  let compiled = 0,
    outside = 0;
  for (const share of found[3].split(", ")) {
    const at = share.lastIndexOf(" ");
    const instructions = Math.max(0, Number(share.slice(at + 1)));
    if (shareOutsideCompiledCode.test(share.slice(0, at))) outside += instructions;
    else compiled += instructions;
  }
  return { label: found[1], compiled, outside, bytes: Number(found[4]) };
}

export function isNoWorse(line: string, recorded: string, operationsCountedOnce: number) {
  const now = numbersOf(line),
    then = numbersOf(recorded);
  if (!now || !then || now.label !== then.label) return false;
  const refills = operationsCountedOnce ? instructionsOfTwoBlockRefills / operationsCountedOnce : 0;
  return (
    now.compiled <= then.compiled + Math.max(0.25, then.compiled * 0.02) &&
    now.outside <= then.outside + Math.max(1, then.outside * 0.15, refills) &&
    now.bytes <= then.bytes * 1.05
  );
}

function recordedLines(testFile: string, title: string) {
  const file = join(import.meta.dir, "__snapshots__", `${testFile}.test.ts.snap`);
  if (!existsSync(file)) return [];
  const titleAsWritten = title.replace(/[\\`]|\$\{/g, "\\$&");
  const start = `exports[\`${titleAsWritten} 1\`] = \``;
  const text = readFileSync(file, "utf8");
  const from = text.indexOf(start);
  if (from < 0) return [];
  return text
    .slice(from + start.length, text.indexOf("`;\n", from))
    .trim()
    .replace(/^"|"$/g, "")
    .split("\n");
}

async function whetherItCounts(platform: string) {
  const isThisPlatform = platform === `${process.platform}-${process.arch}` && !unsupported && !isASAN && !isDebug;
  if (!unsupported && !isThisPlatform)
    console.error(`SKIPPED: test/aot/instruction-counts: the numbers are those of a release build on ${platform}`);
  const reason = isThisPlatform ? await whyInstructionsCannotBeCounted() : undefined;
  if (reason && process.platform === "linux") console.warn(`Only the bytes of compiled code are compared: ${reason}.`);
  return { isThisPlatform, reason };
}

export async function describeInstructionCountsOfPrograms(platform: string) {
  const { isThisPlatform, reason } = await whetherItCounts(platform);
  for (const folder of readdirSync(programs).sort())
    describeCasesOf(join(programs, folder), platform, !isThisPlatform || !!reason);
}

export async function describeInstructionCountsInPlace(platform: string) {
  const { isThisPlatform, reason } = await whetherItCounts(platform);
  for (const folder of readdirSync(inPlace).sort())
    describeCasesOf(join(inPlace, folder), platform, !isThisPlatform || !!reason, `${platform}-in-place`);
}

export async function describeInstructionCountsOfPackages(platform: string) {
  const { isThisPlatform, reason } = await whetherItCounts(platform);
  for (const folder of readdirSync(packages).sort())
    describeCasesOf(join(packages, folder), platform, !isThisPlatform || !!reason, `${platform}-packages`);
}

const partOf = (name: string, parts: number) =>
  ([...name].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 0) % parts) + 1;

export async function describeInstructionCounts(platform: string, part: number, parts: number) {
  const { isThisPlatform, reason } = await whetherItCounts(platform);
  const testFile = part === 1 ? platform : `${platform}-${part}`;
  const typedOnly = join(snippets, "typed-only");
  const files = [
    ...readdirSync(snippets).map(file => ({ file, folder: snippets, formsOfFile: forms })),
    ...(existsSync(typedOnly) ? readdirSync(typedOnly) : []).map(file => ({
      file,
      folder: typedOnly,
      formsOfFile: forms.filter(form => form.types === "typed"),
    })),
  ].filter(({ file }) => file.endsWith(".ts") && partOf(basename(file, ".ts"), parts) === part);
  describeSnippets(files, testFile, isThisPlatform, reason);
}

export async function describeInstructionCountsOutsideLoops(platform: string) {
  const { isThisPlatform, reason } = await whetherItCounts(platform);
  const folder = join(snippets, "outside-loops");
  const files = readdirSync(folder)
    .filter(file => file.endsWith(".ts"))
    .map(file => ({ file, folder, formsOfFile: formsOutsideLoops }));
  describeSnippets(files, `${platform}-outside-loops`, isThisPlatform, reason);
}

export async function describeInstructionCountsBehindDoors(platform: string, heat: Heat = "outside the hottest functions") {
  const { isThisPlatform, reason } = await whetherItCounts(platform);
  const folder = join(snippets, "doors");
  const data = readFileSync(join(folder, "data.ts"), "utf8");
  const door = (name: string, more: Partial<Door> = {}): Door => {
    const [, label, text] = /^\/\/ (.*)\n([^]*)$/.exec(readFileSync(join(folder, "door", `${name}.ts`), "utf8"))!;
    return { name, label, setup: data + text, ...more };
  };
  const literal = door("typed-literal");
  const formsOfFile: Form[] = [
    literal,
    door("json-parse-type-argument", { costsNoMoreThan: literal.label }),
    door("json-parse-type-argument-one-undeclared-key"),
    door("json-parse-type-argument-ten-undeclared-keys"),
    door("bun-validate", { costsNoMoreThan: literal.label, notYetIn: ["stringify.ts"] }),
    door("json-parse-cast"),
    door("json-parse-annotated"),
  ].map(door => ({ types: "typed", place: "function", door }));
  formsOfFile.push({ types: "untyped", place: "function", door: door("json-parse-type-argument", { label: "untyped" }) });
  const files = readdirSync(join(folder, "use")).map(file => ({ file, folder: join(folder, "use"), formsOfFile }));
  describeSnippets(files, heat === "as built" ? `${platform}-doors-as-built` : `${platform}-doors`, isThisPlatform, reason, heat);
}

export async function describeInstructionCountsWhereShapesDiffer(platform: string) {
  const { isThisPlatform, reason } = await whetherItCounts(platform);
  const folder = join(snippets, "several-shapes");
  const formsOfFile: Form[] = [];
  for (const types of ["typed", "untyped"] as const)
    for (const place of ["function", "function that no loop calls"] as const)
      for (const heat of ["outside the hottest functions", "as built"] as const) formsOfFile.push({ types, place, heat });
  const files = readdirSync(folder)
    .filter(file => file.endsWith(".ts"))
    .map(file => ({ file, folder, formsOfFile }));
  describeSnippets(files, `${platform}-several-shapes`, isThisPlatform, reason);
}

const commonOperations = [
  "array-push",
  "await-async-function",
  "call-closure",
  "call-function",
  "call-method",
  "iterate-for-of",
  "json-parse",
  "json-stringify",
  "map-get",
  "new-class-instance",
  "object-literal",
  "object-spread",
  "read-field-of-class",
  "read-field-of-object-literal",
  "read-field-of-parsed-object",
  "string-concat",
  "switch-on-union",
  "write-field-of-class",
  "write-field-of-parsed-object",
];
const operationsThatPlacesDoNotRemember = [
  "call-own-function-far-out-of-line",
  "extra-properties-added-by-name",
  "extra-properties-read-kept-as-any",
  "extra-property-write-type-lost",
  "intl-number-format",
  "method-call-after-keyed-property-type-known",
  "missing-name-read-extra-keys-type-lost",
  "read-getter-defined-through-a-helper",
  "read-getter-of-class-type-lost",
  "read-getter-of-four-classes-at-one-place",
  "read-inherited-property-far-out-of-line",
  "read-own-getter-far-out-of-line",
  "read-own-property-named-like-a-getter",
  "read-own-property-far-out-of-line",
  "write-own-property-far-out-of-line",
];

export async function describeInstructionCountsAsBuilt(platform: string) {
  const { isThisPlatform, reason } = await whetherItCounts(platform);
  const outsideLoops = join(snippets, "outside-loops");
  const files = [
    ...[...commonOperations, ...operationsThatPlacesDoNotRemember].map(name => ({ file: `${name}.ts`, folder: snippets, formsOfFile: forms })),
    ...readdirSync(outsideLoops)
      .filter(file => file.endsWith(".ts"))
      .map(file => ({ file, folder: outsideLoops, formsOfFile: formsOutsideLoops })),
  ];
  describeSnippets(files, `${platform}-as-built`, isThisPlatform, reason, "as built");
}

function describeSnippets(
  files: { file: string; folder: string; formsOfFile: Form[] }[],
  testFile: string,
  isThisPlatform: boolean,
  reason: string | undefined,
  heat: Heat = "outside the hottest functions",
) {
  for (const { file, folder, formsOfFile } of files.sort((a, b) => (a.file < b.file ? -1 : 1))) {
    const name = basename(file, ".ts");
    const pieces = partsOf(file, readFileSync(join(folder, file), "utf8"));
    const lines = linesOf(async () => {
      using dir = tempDir(`instruction-counts-${name}`, {});
      const counted: string[] = [];
      for (const form of formsOfFile) counted.push(await lineOf(name, pieces, form, String(dir), !reason, heat));
      return counted;
    });
    test.skipIf(!isThisPlatform || (!!reason && process.platform === "linux"))(
      pieces.title,
      async () => {
        const recorded = recordedLines(testFile, pieces.title);
        const operationsCountedOnce = isCountedTwice(pieces.operations) ? 0 : pieces.operations * (roundsOfMoreOperations - roundsOfFewerOperations);
        const counted = await lines();
        const shownLines = counted.map((line, index) =>
          recorded[index] !== undefined && isNoWorse(line, recorded[index], operationsCountedOnce) ? recorded[index] : line,
        );
        expect(shownLines.join("\n")).toMatchSnapshot();
        formsOfFile.forEach(({ door }, index) => {
          if (!door?.costsNoMoreThan || door.notYetIn?.includes(file)) return;
          const other = counted[formsOfFile.findIndex(form => form.door?.label === door.costsNoMoreThan)];
          const isKept = isNoWorse(counted[index].replace(door.label, door.costsNoMoreThan), other, operationsCountedOnce);
          expect({ line: counted[index], other, isKept }).toEqual({ line: counted[index], other, isKept: true });
        });
      },
      600_000,
    );
  }
}
