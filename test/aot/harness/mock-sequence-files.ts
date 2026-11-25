// What harness/mock-sequences.ts runs: the events, the sequences, the files of a sequence, and how two runs are held against each other. It imports nothing, so a script can lay and judge the same runs.
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
  // The three ways in which a factory asks for the original: its argument (`over`), the same under Vitest's name, and vi.importActual().
  original: `vi.doMock(DEP, async importOriginal => ({ ...(await importOriginal()), flag: "original#" }));`,
  actual: `vi.doMock(DEP, async () => ({ ...(await vi.importActual(DEP)), flag: "actual#" }));`,
  "throws-late": `vi.doMock(DEP, async original => { const real = await original(); throw new Error("overdue boom " + ++booms + " over " + real.plain); });`,
  // The build reads who asks for an original. These only name it.
  comment: `vi.doMock(DEP, () => { /* await vi.importActual(DEP), importOriginal(), original() */ return { flag: "comment#", plain: "comment#" }; });`,
  string: `vi.doMock(DEP, () => ({ flag: "string#", plain: "vi.importActual(importOriginal)#" }));`,
  single: `vi.doMock(SINGLE, () => ({ flag: 'single#', plain: 'single#' }));`,
  "single-over": `vi.doMock(SINGLE, async original => ({ ...(await original()), flag: 'single-over#' }));`,
  "single-actual": `vi.doMock(SINGLE, async () => ({ ...(await vi.importActual(SINGLE)), flag: 'single-actual#' }));`,
};

export const alphabet = Object.keys(events);

const asks = "original,actual,throws-late comment,string,single single-over,single-actual,one";
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
  // Every way of asking for the original and of only naming it, in each place and over each body; behind them what a draw of 1,560 found.
  // Where a factory asks for an original whose body throws, how far `bun test` itself gets goes by the clock: mock-sequence-hunt.ts draws those, no test holds them.
  "js late asks": `${asks} comment,comment,comment comment,unmock,throws one,throws-late,reset string,single,rejects`,
  "js top asks": asks,
  "js required asks": `${asks} comment,one,one one,two,actual string,one,throws throws-late,unmock,restore one,single-over,over`,
  "cjs late asks": asks,
  "cjs top asks": asks,
  "cjs required asks": `${asks} throws-late,reset,single-actual`,
  "js late awaits": `${asks} comment,comment,one string,reset,one rejects,module,actual one,async,unmock`,
  "js top awaits": `${asks} one,over,unmock`,
  "js required awaits": `${asks} comment,single,single actual,actual,actual one,actual,reset rejects-over,over,says one,rejects,single-over`,
  "js late throws": "comment,string,single comment,comment,comment",
  "js required throws": "comment,string,single comment,comment,comment two,two,rejects bare,bare,bare",
  "cjs late throws": "comment,string,single",
  "cjs required throws": "comment,string,single",
};

// What the body of the mocked module does besides exporting: nothing, `await 0` ahead of its exports, or a throw behind them.
export type Body = "" | "awaits" | "throws";
export type Sequence = { id: string; steps: string[]; kind: string; atTop: boolean; isRequired: boolean; body: Body };

export const sequenceOf = (steps: string, kind: string, place: string, body: Body): Sequence => ({
  id: `${steps.replaceAll(",", "+")}.${kind}.${place}${body && "." + body}`,
  steps: steps.split(","),
  kind,
  atTop: place === "top",
  isRequired: place === "required",
  body,
});

export const all: Sequence[] = Object.entries(sequences).flatMap(([where, list]) => {
  const [kind, place, body] = where.split(" ");
  return list.split(" ").map(steps => sequenceOf(steps, kind, place, body === "awaits" || body === "throws" ? body : ""));
});

export function filesOf(
  { id, steps, kind, atTop, isRequired, body }: Sequence,
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
        `  globalThis.moment = "in the call of ${index + 1} ${event}";\n  try { ${events[event].replaceAll("DEP", dep).replaceAll("SINGLE", dep.replaceAll('"', "'")).replaceAll("#", String(index + 1))} } catch (e) { say("${index + 1} ${event}", "the call:", "threw " + String(e.message).slice(0, 40)); }\n  say("${index + 1} ${event}", "held:", "late", held ? await tried(() => held.values()) : "none", "top", ${atTop ? look("values", "top") : `"none"`});\n  await look("${index + 1} ${event}");\n`,
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
      (body === "awaits" ? `await 0;\n` : "") +
      (kind === "js"
        ? `export const flag = "real";\nexport const plain = "real";\n`
        : `exports.flag = "real";\nexports.plain = "real";\n`) +
      (body === "throws" ? `throw new Error("the body throws " + globalThis.bodies);\n` : ""),
    [`src/${id}/first.js`]: `globalThis.sequence = "${id}";\nglobalThis.bodies = 0;\nglobalThis.moment = undefined;\n`,
    [`src/${id}/user-top.js`]: user,
    [`src/${id}/user-late.js`]: user,
  };
}

export type Printed = Map<string, string>;

const fieldsOf = (text: string) => text.split(/ (?=(?:import|require|late|top) )/);

export function printed(stdout: string, stderr: string, exitCode: number | null, ids: string[]): Printed {
  const lines: Printed = new Map();
  for (const line of (stdout + "\n" + stderr).split("\n")) {
    const found = line.match(/^\| (\S+) (\d \S+ [a-z ]+:) (.*)$/);
    if (found) lines.set(`${found[1]} ${found[2]}`, found[3]);
  }
  // Of a pack it says little, and which of its rejections nobody handled goes by the clock.
  if (ids.length > 1) return lines;
  const errors = stderr
    .split("\n")
    .filter(line => /^error: |^panic/.test(line))
    .sort();
  lines.set(`${ids[0]} 9 whole run:`, `exit ${exitCode}${errors.map(line => " " + line.slice(0, 60)).join("")}`);
  return lines;
}

export function differences(plain: Printed, compiled: Printed, way: string): string[] {
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
