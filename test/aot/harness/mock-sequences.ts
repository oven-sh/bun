import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "../supported";
import { afterAll } from "./default-timeout";
import { run } from "./run";

const events: Record<string, string> = {
  one: `vi.doMock(DEP, () => ({ flag: "one#", plain: "one#" }));`,
  two: `vi.doMock(DEP, () => ({ flag: "two#" }));`,
  added: `vi.doMock(DEP, () => ({ flag: "three#", plain: "three#", added: "added#" }));`,
  async: `vi.doMock(DEP, async () => { await 0; return { flag: "async#", plain: "async#" }; });`,
  over: `vi.doMock(DEP, async original => ({ ...(await original()), flag: "over#" }));`,
  throws: `vi.doMock(DEP, () => { throw new Error("boom " + ++booms); });`,
  "throws-over": `vi.doMock(DEP, original => { throw new Error("boom over " + ++booms); });`,
  rejects: `vi.doMock(DEP, async () => { await 0; throw new Error("tardy boom " + ++booms); });`,
  "rejects-over": `vi.doMock(DEP, async original => { await 0; throw new Error("tardy boom over " + ++booms); });`,
  bare: `vi.doMock(DEP);`,
  unmock: `vi.doUnmock(DEP);`,
  reset: `vi.resetModules();`,
  restore: `mock.restore();`,
  module: `mock.module(DEP, () => ({ flag: "module#", plain: "module#" }));`,
  says: `vi.doMock(DEP, () => { say(++runs + " says", "the factory:", "runs " + globalThis.moment); return { flag: "says#", plain: "says#" }; });`,
};

const sequences = {
  "js top":
    "added,throws,bare added,throws,module added,throws-over,bare added,two,module async,async,reset async,restore,unmock async,throws-over,unmock bare,reset,bare module,added,module module,rejects,bare module,unmock,over one,async,bare one,rejects,added one,restore,restore one,unmock,async over,async,module rejects,module,bare rejects,module,reset rejects,over,unmock rejects,throws-over,one rejects,throws-over,rejects reset,added,unmock restore,added,two throws,one,two throws,reset,async throws,two,reset two,added,throws-over unmock,one,one unmock,one,throws unmock,over,async unmock,rejects,module",
  "js late":
    "added,reset,unmock async,bare,bare async,restore,over async,throws,module bare,async,throws-over bare,one,over bare,over,one bare,over,unmock module,rejects,two module,reset,rejects over,module,module over,module,throws over,one,reset rejects,module,reset reset,added,restore throws-over,bare,over throws-over,over,over throws,throws-over,bare throws,two,async throws,unmock,throws-over two,module,async unmock,added,bare unmock,module,unmock",
  "cjs top":
    "added,added,two added,one,added added,rejects,async added,throws-over,async async,added,restore async,restore,rejects async,two,over async,unmock,module bare,added,async bare,rejects,two module,added,over module,added,rejects one,async,unmock one,module,bare one,restore,async over,bare,restore rejects,over,rejects reset,rejects,unmock reset,throws,module reset,throws-over,throws restore,bare,unmock restore,over,unmock restore,rejects,over restore,two,added throws,added,throws-over throws,module,unmock throws,one,module throws-over,bare,unmock throws-over,over,unmock two,over,two two,unmock,module two,unmock,one unmock,async,one",
  "cjs late":
    "added,async,one added,one,added async,async,two bare,restore,throws module,added,over one,bare,over one,restore,one one,throws-over,one one,two,over over,one,two over,throws,bare rejects,over,throws-over rejects,reset,bare reset,rejects,throws reset,throws-over,one reset,throws-over,throws restore,bare,unmock restore,two,added restore,two,async throws,added,one throws,one,bare throws-over,one,throws-over throws-over,two,throws throws,rejects,async throws,throws,rejects throws,two,bare two,added,async two,throws,throws unmock,throws,bare",
  "js late more": "one,says,says says,says,unmock async,says,throws",
  "js top more": "one,says,says",
  "cjs late more": "one,says,says",
  "js late still more":
    "rejects-over,bare,over rejects-over,over,over one,rejects-over,one rejects-over,rejects-over,unmock",
  "js top still more": "rejects-over,one,unmock",
  "cjs late still more": "rejects-over,bare,over one,rejects-over,one",
  "js required": "async,one,unmock rejects,one,unmock one,async,two over,bare,one one,two,unmock",
  "cjs required": "async,one,unmock rejects,one,unmock one,async,two",
};

type Sequence = { id: string; steps: string[]; kind: string; atTop: boolean; isRequired: boolean };

export const all: Sequence[] = Object.entries(sequences).flatMap(([where, list]) => {
  const [kind, place] = where.split(" ");
  return list.split(" ").map(steps => ({
    id: `${steps.replaceAll(",", "+")}.${kind}.${place}`,
    steps: steps.split(","),
    kind,
    atTop: place === "top",
    isRequired: place === "required",
  }));
});

export function filesOf(
  { id, steps, kind, atTop, isRequired }: Sequence,
  fillers: number,
  hasNextFile = false,
): Record<string, string> {
  const late = `${isRequired ? "import.meta.require" : "await import"}("../src/${id}/user-late.js")`;
  const dep = `"../src/${id}/dep.${kind}"`;
  const fill = Array.from({ length: fillers }, (_, n) => `import "../../fill/f${n}.js";\n`).join("");
  const user = `${fill}import { flag, plain } from "./dep.${kind}";
import * as ns from "./dep.${kind}";
const tried = read => { try { return String(read()); } catch (e) { return "threw " + String(e.message).replace(/\\/\\S*\\//g, "").slice(0, 40); } };
export const values = () => [flag, plain, ns.flag].join();
export const names = () => [Object.keys(ns).sort().join("+"), tried(() => ns.nobodyExportsThis), tried(() => JSON.stringify(ns))].join(" ");
`;
  const look = (read: string, of: string) => `await tried(async () => (${of}).${read}())`;
  const looks = `import "../src/${id}/first.js";
import { vi, mock, test } from "bun:test";
${atTop ? `import * as top from "../src/${id}/user-top.js";\n` : ""}let booms = 0, runs = 0, held;
const say = (...words) => console.log("| ${id}", ...words);
const tried = async read => { try { return String(await read()); } catch (e) { return "threw " + String(e.message).replace(/\\/\\S*\\//g, "").slice(0, 40); } };
async function look(step) {
  globalThis.moment = "behind " + step;
  say(step, "values:", "import", await tried(async () => (await import(${dep})).flag), "require", await tried(() => import.meta.require(${dep}).flag), "late", ${look("values", `held = ${late}`)}, "top", ${atTop ? look("values", "top") : `"none"`});
  say(step, "names:", "import", await tried(async () => Object.keys(await import(${dep})).sort().join("+")), "late", ${look("names", late)}, "top", ${atTop ? look("names", "top") : `"none"`});
}
`;
  const text = `${looks}test("${id}", async () => {
${atTop ? `  await look("0 start");\n` : ""}${steps
    .map(
      (event, index) =>
        `  globalThis.moment = "in the call of ${index + 1} ${event}";\n  try { ${events[event].replaceAll("DEP", dep).replaceAll("#", String(index + 1))} } catch (e) { say("${index + 1} ${event}", "the call:", "threw " + String(e.message).slice(0, 40)); }\n  say("${index + 1} ${event}", "held:", "late", held ? await tried(() => held.values()) : "none", "top", ${atTop ? look("values", "top") : `"none"`});\n  await look("${index + 1} ${event}");\n`,
    )
    .join("")}});
`;
  return {
    [`test/${id}.test.js`]: text,
    // The mocks of a test file end with it: a next file, which mocks nothing, looks once more.
    ...(hasNextFile && {
      [`test/${id}.test.next.test.js`]: `${looks}test("${id}, the next file", () => look("8 next"));\n`,
    }),
    [`src/${id}/dep.${kind}`]:
      `if (globalThis.sequence === "${id}") console.log("| ${id} " + (globalThis.bodies = (globalThis.bodies ?? 0) + 1) + " body the body:", "runs " + (globalThis.moment ?? "at the top"));\n` +
      (kind === "js"
        ? `export const flag = "real";\nexport const plain = "real";\n`
        : `exports.flag = "real";\nexports.plain = "real";\n`),
    [`src/${id}/first.js`]: `globalThis.sequence = "${id}";\nglobalThis.bodies = 0;\nglobalThis.moment = undefined;\n`,
    [`src/${id}/user-top.js`]: user,
    [`src/${id}/user-late.js`]: user,
  };
}

const fillers = 20;
const bytesOfFillers = 1_500_000;

function withShape(group: Sequence[], hasNextFiles = false): Record<string, string> {
  const files: Record<string, string> = { "package.json": `{ "type": "module" }` };
  for (const sequence of group) Object.assign(files, filesOf(sequence, fillers, hasNextFiles));
  const below = group.map(({ id, kind }) => `import "../src/${id}/dep.${kind}";\n`).join("");
  const functions = Math.ceil(bytesOfFillers / fillers / 46);
  for (let n = 0; n < fillers; n++) {
    let text = below;
    for (let i = 0; i < functions; i++) text += `export function f${n}_${i}(x) { return x + ${i}; }\n`;
    files[`fill/f${n}.js`] = text;
  }
  return files;
}

type Printed = Map<string, string>;

const nameOf = (ids: string[]) => (ids.length === 1 ? ids[0] : `group-of-${ids[0]}`);
const fieldsOf = (text: string) => text.split(/ (?=(?:import|require|late|top) )/);

function printed(stdout: string, stderr: string, exitCode: number | null, ids: string[]): Printed {
  const lines: Printed = new Map();
  for (const line of (stdout + "\n" + stderr).split("\n")) {
    const found = line.match(/^\| (\S+) (\d \S+ [a-z ]+:) (.*)$/);
    if (found) lines.set(`${found[1]} ${found[2]}`, found[3]);
  }
  const errors = stderr
    .split("\n")
    .filter(line => /^error: |^panic/.test(line))
    .sort();
  lines.set(`${nameOf(ids)} 9 whole run:`, `exit ${exitCode}${errors.map(line => " " + line.slice(0, 60)).join("")}`);
  return lines;
}

function differences(plain: Printed, compiled: Printed, way: string): string[] {
  const found: string[] = [];
  for (const key of new Set([...plain.keys(), ...compiled.keys()])) {
    const [expected, got] = [plain.get(key), compiled.get(key) ?? "nothing"];
    if (expected === got) continue;
    const theirs = fieldsOf(expected ?? "");
    const diedBefore = got === "nothing" && /(?:values|names|held):$/.test(key);
    const isLoud =
      diedBefore ||
      fieldsOf(got).every((field, index) => field === theirs[index] || /threw |error: |panic|exit [1-9]/.test(field));
    found.push(`${way} ${key} ${isLoud ? "loud" : "SILENT"} | ${got}`);
  }
  return found;
}

const list = join(import.meta.dir, "..", "mock-sequences.known.txt");
const rewrite = !!process.env.BUN_AOT_REWRITE_MOCK_SEQUENCES;
const known = readFileSync(list, "utf8").split("\n");
const withoutName = (line: string) => line.replace(/^(\S+) /, "");
const idOf = (line: string) => withoutName(line).split(" ")[1];
const isEntry = (line: string) => !!line && !/^[#~]/.test(line);
const keyOf = (line: string) => line.split(" | ")[0].replace(/ (loud|SILENT)$/, "");
const wavers = new Set(known.filter(line => line.startsWith("~ ")).map(line => line.replace(/^~ \S+ /, "")));
const isSteady = (line: string) => !wavers.has(keyOf(line));
const seen: string[] = [];
const asked = new Set<string>();

function judge(way: string, ids: string[], differing: string[]) {
  const found = differing.filter(isSteady);
  seen.push(...found);
  for (const id of [...ids, nameOf(ids)]) asked.add(`${way} ${id}`);
  if (rewrite) return;
  const mine = (line: string) =>
    isEntry(line) && withoutName(line).startsWith(way + " ") && [...ids, nameOf(ids)].includes(idOf(line));
  expect(found.sort()).toEqual(known.filter(mine).map(withoutName).sort());
}

const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: "TestRunSaysItsForm" };

async function runOf(cwd: string, ids: string[], ...flags: string[]) {
  const isOneRealm = flags.includes("--no-isolate");
  const saysItsPlan = flags.includes("--aot-memory-limit") ? { BUN_JSC_logAOTPhaseTimes: "1" } : {};
  const { stdout, stderr, exitCode } = await run(
    [
      bunExe(),
      "test",
      ...flags,
      ...ids.flatMap(id => (isOneRealm ? [id, `${id}.test.next`] : [id]).map(name => `./test/${name}.test.js`)),
    ],
    cwd,
    {
      ...env,
      ...saysItsPlan,
    },
  );
  return { lines: printed(stdout, stderr, exitCode, ids), stderr };
}

const inGroupsOf = (size: number, sequences: Sequence[]) =>
  Array.from({ length: Math.ceil(sequences.length / size) }, (_, index) =>
    sequences.slice(index * size, (index + 1) * size),
  );

// The company of the others in one build changes what these say.
const alone = [
  "async+one+unmock.cjs.required",
  "one+async+two.cjs.required",
  "one+rejects-over+one.cjs.late",
  "rejects-over+bare+over.cjs.late",
];
// Behind the first vi.resetModules() of a realm every file that has run is loaded from its text, as under `bun test`: nothing compiled is left to ask.
const byResets = [false, true].map(resets => all.filter(({ steps }) => steps.includes("reset") === resets));

type Case = { way: string; title: string; group: Sequence[]; flags: string[] };

const cases: Case[] = [
  ...inGroupsOf(34, all).map(group => ({ way: "one", title: "as one program", group, flags: ["--isolate"] })),
  ...all
    .filter(({ id }) => alone.includes(id))
    .map(sequence => ({ way: "alone", title: "alone", group: [sequence], flags: [] })),
  ...inGroupsOf(34, all).map(group => ({ way: "layers", title: "over layers", group, flags: ["--parallel=2"] })),
  ...byResets
    .flatMap((sequences, resets) => inGroupsOf(resets ? 6 : 24, sequences))
    .map(group => ({
      way: "realm",
      title: "over layers, in one realm, each with a next file",
      group,
      flags: ["--parallel=1", "--no-isolate"],
    })),
];

/**
 * Three mock events in a row on one module. After each, what import(), require(), a user that is loaded late and a user that
 * was linked at the top see. The ways: `one`: as one program, a realm a file; `alone`: one sequence, one program; `layers`: over
 * the layers that a run takes by itself, with the mocked files in a lower image than their users, two workers; `realm`: the same
 * in one realm, where behind each a next file that mocks nothing looks once more.
 * mock-sequences.known.txt holds every line that differs from a plain run: a line that is cured, one that changes and a new one
 * all fail.
 * BUN_AOT_REWRITE_MOCK_SEQUENCES=1 writes the lines of what ran anew and keeps their names.
 */
export function mockSequences(part: number, of: number) {
  for (const { way, title, group, flags } of cases.filter((_, index) => index % of === part)) {
    const ids = group.map(sequence => sequence.id);
    const isOverLayers = way === "layers" || way === "realm";
    test(`${title}: ${ids.length > 6 ? `${ids.length} from ${ids[0]}` : ids.join(" ")}`, async () => {
      const files = isOverLayers
        ? withShape(group, way === "realm")
        : Object.assign({ "package.json": `{ "type": "module" }` }, ...group.map(sequence => filesOf(sequence, 0)));
      using dir = tempDir("aot-mock-sequences", files);
      const plain = await runOf(String(dir), ids, ...flags);
      const compiled = await runOf(
        String(dir),
        ids,
        "--aot",
        ...flags,
        ...(isOverLayers ? ["--aot-memory-limit", "1MB"] : []),
      );
      if (isOverLayers) {
        if (compiled.stderr.includes("this Bun loads one program a realm")) return;
        expect(compiled.stderr).toMatch(/^AOT test run \| layers [2-9] \|/m);
        expect(compiled.stderr).toMatch(/the layers are planned: .* \| [2-9] programs, each/);
      } else expect(compiled.stderr).toContain("AOT test run | one program");
      judge(way, ids, differences(plain.lines, compiled.lines, way));
    }, 270_000);
  }
  afterAll(() => {
    if (!rewrite) return;
    const now = readFileSync(list, "utf8").split("\n");
    const names = new Map(now.filter(isEntry).map(line => [keyOf(withoutName(line)), line.split(" ")[0]]));
    const kept = now.filter(line => isEntry(line) && !asked.has(withoutName(line).split(" ", 2).join(" ")));
    const mine = seen.map(line => `${names.get(keyOf(line)) ?? "?"} ${line}`);
    const byKey = (a: string, b: string) => (withoutName(a) < withoutName(b) ? -1 : 1);
    writeFileSync(list, [...now.filter(line => /^[#~]/.test(line)), ...[...kept, ...mine].sort(byKey), ""].join("\n"));
  });
}
