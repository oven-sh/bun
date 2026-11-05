// A test replaces what a module exports: `spyOn(lib, "f")`, `mock.module("./lib.js", () => ({ ...lib, f: fake }))`, a store to the
// exports of a CommonJS file, a spy on a method of an exported class or object. Which of the roads to `f` then reach the fake is a fine
// point of plain Bun: the named import of the test file, the namespace, a barrel that exports it again, under another name, a file
// that imported it first, a call inside the module itself, require(), import(). A compiled test run has to answer as plain on every
// road. Each program is a small project; each scene asks every road, replaces one export, asks again, puts it back, asks again.
// The barrels stand over the ES module and over the CommonJS file, by name and by a star, and one over the others; each namespace
// object is also read under a name that is made at run time, which asks the object itself.
//
// Only for run-as-tests.ts: the programs import bun:test. With --as-packages the project's files lie in a package.
import type { Random } from "./random";

/** `@` is the number of the scene, `F` the fake. */
interface Way {
  replace: string;
  restore: string;
  imports?: string[];
}
const spies = (holder: string, name: string): Way[] => [
  {
    replace: `const spy@ = spyOn(${holder}, "${name}").mockImplementation(F);`,
    restore: "spy@.mockRestore();",
    imports: ["spyOn"],
  },
  { replace: `const spy@ = spyOn(${holder}, "${name}").mockImplementation(F);`, restore: "mock.restore();", imports: ["spyOn", "mock"] }, // prettier-ignore
  { replace: `const spy@ = spyOn(${holder}, "${name}");\n  spy@.mockReturnValue("fake @");`, restore: "spy@.mockRestore();", imports: ["spyOn"] }, // prettier-ignore
  {
    replace: `jest.spyOn(${holder}, "${name}").mockImplementation(F);`,
    restore: "jest.restoreAllMocks();",
    imports: ["jest"],
  },
  {
    replace: `vi.spyOn(${holder}, "${name}").mockImplementation(F);`,
    restore: "vi.restoreAllMocks();",
    imports: ["vi"],
  },
  { replace: `const spy@ = spyOn(${holder}, made("${name}")).mockImplementation(F);`, restore: "spy@.mockRestore();", imports: ["spyOn"] }, // prettier-ignore
  { replace: `const spy@ = spyOn((await Promise.all([${holder}]))[0], "${name}").mockImplementation(F);`, restore: "spy@.mockRestore();", imports: ["spyOn"] }, // prettier-ignore
  { replace: `const spy@ = watch(${holder}, "${name}", F);`, restore: "spy@.mockRestore();", imports: ["spyOn"] },
];
const stores = (holder: string, name: string): Way[] => [
  { replace: `const kept@ = ${holder}.${name};\n  ${holder}.${name} = F;`, restore: `${holder}.${name} = kept@;` },
  {
    replace: `const kept@ = ${holder}.${name};\n  ${holder}[made("${name}")] = F;`,
    restore: `${holder}.${name} = kept@;`,
  },
  { replace: `const kept@ = ${holder}.${name};\n  ${holder}.${name} = mock(F);`, restore: `${holder}.${name} = kept@;`, imports: ["mock"] }, // prettier-ignore
  {
    replace: `const kept@ = Object.getOwnPropertyDescriptor(${holder}, "${name}");\n  Object.defineProperty(${holder}, "${name}", { value: F, writable: true, configurable: true, enumerable: true });`,
    restore: `Object.defineProperty(${holder}, "${name}", kept@);`,
  },
];
const modules = (file: string, whole: string, name: string): Way[] => [
  {
    replace: `const kept@ = { ...${whole} };\n  mock.module("${file}", () => ({ ...kept@, ${name}: F }));`,
    restore: `mock.module("${file}", () => kept@);`,
    imports: ["mock"],
  },
  {
    replace: `const kept@ = { ...${whole} };\n  await mock.module("${file}", async () => ({ ...kept@, ${name}: F }));`,
    restore: `await mock.module("${file}", () => kept@);`,
    imports: ["mock"],
  },
  {
    replace: `const kept@ = { ...${whole} };\n  jest.mock("${file}", () => ({ ...kept@, ${name}: F }));`,
    restore: `jest.mock("${file}", () => kept@);`,
    imports: ["jest"],
  },
];

const targets: Way[][] = [
  [...spies("lib", "f"), ...modules("./lib.js", "lib", "f")],
  [...spies("lib", "f"), ...modules("./lib.js", "lib", "f")],
  [...spies("lib", "g"), ...modules("./lib.js", "lib", "g")],
  [...spies("lib", "default"), ...modules("./lib.js", "lib", "default")],
  [...spies("lib", "callsF"), ...modules("./lib.js", "lib", "callsF")],
  [...spies("lib", "bump")],
  [...spies("barrel", "f"), ...modules("./barrel.js", "barrel", "f")],
  [...spies("barrel", "renamed"), ...modules("./barrel.js", "barrel", "renamed")],
  [...spies("barrel", "d")],
  [...spies("K.prototype", "m"), ...stores("K.prototype", "m")],
  [...spies("K", "s"), ...stores("K", "s")],
  [...spies("lib.K.prototype", "m")],
  [...spies("table", "h"), ...stores("table", "h")],
  [...spies("lib.table", "h"), ...stores("lib.table", "h")],
  [...spies("common", "c"), ...stores("common", "c"), ...modules("./common.cjs", "common", "c")],
  [...spies("common", "c"), ...stores("common", "c"), ...modules("./common.cjs", "common", "c")],
  [...spies("commonAll", "c")],
  [...spies("common.obj", "o"), ...stores("common.obj", "o")],
  [...spies("common", "callsC"), ...stores("common", "callsC")],
  [...spies('require("./common.cjs")', "c"), ...stores('require("./common.cjs")', "c")],
  [...spies("barrelC", "cOfBarrel"), ...modules("./barrelc.js", "barrelC", "cOfBarrel")],
  [...spies("barrelC", "cOfBarrel")],
  [...spies("barrelC", "callsC")],
  [...spies("starC", "c"), ...modules("./starc.js", "starC", "c")],
  [...spies("starC", "c")],
  [...spies("stars", "c"), ...spies("stars", "f"), ...spies("stars", "renamed"), ...spies("stars", "cOfBarrel")],
  [...spies("commonAll", "c"), ...spies("commonAll", "callsC")],
  // Not drawn: a store to an imported namespace, `lib.f = fake`. The build always refuses the file, in words, and a run with such a file
  // in it has to be judged again file by file.
];

export function generate(random: Random): { text: string; files: Record<string, string> } {
  const [a, b, c] = [random.between(1, 9), random.between(2, 9), random.between(1, 9)];
  const imports = new Set(["test"]);
  const scenes: string[] = [];
  // Some faults show only where nothing else in the run is replaced.
  const count = random.pick([1, 1, 2, 3]);
  for (let scene = 0; scene < count; scene++) {
    const way = random.pick(random.pick(targets));
    for (const name of way.imports ?? []) imports.add(name);
    const fill = (text: string) =>
      text.replaceAll("@", String(scene)).replace(/\bF\b/g, `function (...given) {\n    return "fake ${scene}";\n  }`);
    const steps = [
      `await ask("${scene} before");`,
      "try {",
      fill(way.replace),
      `await ask("${scene} replaced");`,
      fill(way.restore),
      `} catch (error) {\n    say("${scene} threw " + error.constructor.name + ": " + short(error.message));\n  }`,
      `await ask("${scene} put back");`,
    ].join("\n  ");
    scenes.push(random.chance(0.5) ? `test("scene ${scene}", async () => {\n  ${steps}\n});` : `{\n  ${steps}\n}`);
  }
  const files = {
    "lib.js": `export function f(x) {
  return x + ${a};
}
export const g = x => x * ${b};
export class K {
  m() {
    return "K.m ${c}";
  }
  static s() {
    return "K.s ${c}";
  }
}
export const table = {
  h() {
    return "table.h ${a}";
  },
};
export let count = 0;
export function bump() {
  return ++count;
}
export function callsF(x) {
  return f(x) + 100;
}
export default function d(x) {
  return "d " + x;
}
`,
    "user.js": `import d, { f, g, K, table, callsF } from "./lib.js";
import * as all from "./lib.js";
export const uses = {
  "f": () => f(1),
  "g": () => g(2),
  "new K().m": () => new K().m(),
  "K.s": () => K.s(),
  "table.h": () => table.h(),
  "d": () => d(3),
  "callsF": () => callsF(1),
  "all.f": () => all.f(1),
  "all.default": () => all.default(3),
};
`,
    "barrel.js": `export * from "./lib.js";
export { f as renamed, default as d } from "./lib.js";
`,
    "common.cjs": `function c(x) {
  return x + ${b};
}
exports.c = c;
exports.obj = {
  o() {
    return "obj.o ${a}";
  },
};
exports.callsC = x => exports.c(x) + 100;
exports.callsOwn = x => c(x) + 200;
`,
    "barrelc.js": `export { c as cOfBarrel, callsC } from "./common.cjs";
`,
    "starc.js": `export * from "./common.cjs";
`,
    "stars.js": `export * from "./starc.js";
export * from "./barrel.js";
export { cOfBarrel } from "./barrelc.js";
`,
    "userc.js": `import common, { c, callsC, callsOwn } from "./common.cjs";
export const usesC = {
  "c": () => c(1),
  "common.c": () => common.c(1),
  "callsC": () => callsC(1),
  "callsOwn": () => callsOwn(1),
  "common.obj.o": () => common.obj.o(),
};
`,
  };
  const text = `import { ${[...imports].sort().join(", ")} } from "bun:test";
import d, { f, g, K, table, callsF, bump } from "./lib.js";
import * as lib from "./lib.js";
import * as barrel from "./barrel.js";
import { renamed, f as fOfBarrel } from "./barrel.js";
import { uses } from "./user.js";
import common, { c } from "./common.cjs";
import * as commonAll from "./common.cjs";
import { usesC } from "./userc.js";
import * as barrelC from "./barrelc.js";
import { cOfBarrel } from "./barrelc.js";
import * as starC from "./starc.js";
import { c as cOfStar } from "./starc.js";
import * as stars from "./stars.js";
import { c as cOfStars, f as fOfStars, cOfBarrel as cOfBarrelOfStars } from "./stars.js";
const say = console.log.bind(console);
const short = text => String(text).replace(/\\/[^ '"]*\\//g, "").slice(0, 90);
function made(name) {
  let text = "";
  for (let i = 0; i < name.length; i++) text += name[i];
  return text;
}
function watch(on, name, fake) {
  return spyOn(on, name).mockImplementation(fake);
}
const holders = { lib, barrel, commonAll, barrelC, starC, stars };
const at = (holder, name) => holders[made(holder)][made(name)];
// Not asked: require() of the ES module. Plain answers the mock's own object if the module was required before it was mocked and the
// namespace if not; a compiled run answers the namespace. That is known and set aside.
const roads = {
  "f": () => f(1),
  "lib.f": () => lib.f(1),
  "barrel.f": () => barrel.f(1),
  "f of the barrel": () => fOfBarrel(1),
  "renamed": () => renamed(1),
  "barrel.renamed": () => barrel.renamed(1),
  "callsF": () => callsF(1),
  "lib.callsF": () => lib.callsF(1),
  "g": () => g(2),
  "lib.g": () => lib.g(2),
  "d": () => d(3),
  "lib.default": () => lib.default(3),
  "barrel.d": () => barrel.d(3),
  "new K().m": () => new K().m(),
  "new lib.K().m": () => new lib.K().m(),
  "K.s": () => K.s(),
  "table.h": () => table.h(),
  "lib.table.h": () => lib.table.h(),
  "typeof bump": () => typeof bump,
  "imported f": async () => (await import("./lib.js")).f(1),
  "imported barrel.renamed": async () => (await import("./barrel.js")).renamed(1),
  "c": () => c(1),
  "common.c": () => common.c(1),
  "commonAll.c": () => commonAll.c(1),
  "commonAll.default.c": () => commonAll.default.c(1),
  "common.callsC": () => common.callsC(1),
  "common.callsOwn": () => common.callsOwn(1),
  "common.obj.o": () => common.obj.o(),
  "required c": () => require("./common.cjs").c(1),
  "imported c": async () => (await import("./common.cjs")).c(1),
  "cOfBarrel": () => cOfBarrel(1),
  "barrelC.cOfBarrel": () => barrelC.cOfBarrel(1),
  "barrelC.callsC": () => barrelC.callsC(1),
  "c of the star": () => cOfStar(1),
  "starC.c": () => starC.c(1),
  "starC.callsC": () => starC.callsC(1),
  "c of the stars": () => cOfStars(1),
  "f of the stars": () => fOfStars(1),
  "cOfBarrel of the stars": () => cOfBarrelOfStars(1),
  "stars.c": () => stars.c(1),
  "stars.f": () => stars.f(1),
  "stars.renamed": () => stars.renamed(1),
  "stars.cOfBarrel": () => stars.cOfBarrel(1),
  "imported starC.c": async () => (await import("./starc.js")).c(1),
  "imported stars.c": async () => (await import("./stars.js")).c(1),
  "at lib.f": () => at("lib", "f")(1),
  "at barrel.f": () => at("barrel", "f")(1),
  "at barrel.renamed": () => at("barrel", "renamed")(1),
  "at commonAll.c": () => at("commonAll", "c")(1),
  "at barrelC.cOfBarrel": () => at("barrelC", "cOfBarrel")(1),
  "at starC.c": () => at("starC", "c")(1),
  "at stars.c": () => at("stars", "c")(1),
  "at stars.f": () => at("stars", "f")(1),
  "at stars.cOfBarrel": () => at("stars", "cOfBarrel")(1),
  "keys of the stars": () => Object.keys(stars).sort().join(),
};
async function ask(label) {
  const answers = [];
  for (const [group, asked] of [["", roads], ["user: ", uses], ["userc: ", usesC]])
    for (const name in asked) {
      let text;
      try {
        text = String(await asked[name]());
      } catch (error) {
        text = "throws " + error.constructor.name;
      }
      answers.push(group + name + " = " + text);
    }
  say(label + "\\n  " + answers.join("\\n  "));
}
${imports.has("spyOn") ? "" : 'import { spyOn } from "bun:test";\n'}${scenes.join("\n")}
`;
  return { text, files };
}
