// A test loads a module again: it deletes the file from require.cache and requires or imports it anew, or imports it under a query.
// Plain Bun then runs the file a second time, and what the new copy imports is the old instance or again a new one, by what else was
// deleted. A compiled test run has to hand out the same instances. Every file of the project takes a number when it runs and counts
// its calls, so an answer tells which instance was reached and who shares it. Each program draws which files the test file imports
// up front (the others have not run when they are first asked for), then some steps; behind each step it asks every module object
// that it has got so far.
//
// Only for run-as-tests.ts: the programs import bun:test.
import type { Random } from "./random";

// The number is the file's own: in which order the files first run is another matter.
const born = (name: string) =>
  `const births = (globalThis.births ??= {});\nconst me = "${name}#" + (births.${name} = (births.${name} ?? 0) + 1);\nlet calls = 0;\n`;
const files: Record<string, string> = {
  "state.js": `${born("state")}export const who = me;\nexport function bump() {\n  return me + ":" + ++calls;\n}\n`,
  "statec.cjs": `${born("statec")}exports.who = me;\nexports.bump = function () {\n  return me + ":" + ++calls;\n};\n`,
  "user.js": `import { bump } from "./state.js";\n${born("user")}export const who = me;\nexport function viaUser() {\n  return me + ":" + ++calls + " > " + bump();\n}\n`,
  "userc.cjs": `const state = require("./statec.cjs");\n${born("userc")}exports.who = me;\nexports.viaUserC = function () {\n  return me + ":" + ++calls + " > " + state.bump();\n};\n`,
  "mixed.js": `import { bump } from "./statec.cjs";\n${born("mixed")}export const who = me;\nexport function viaMixed() {\n  return me + ":" + ++calls + " > " + bump();\n}\n`,
  "mixedc.cjs": `const state = require("./state.js");\n${born("mixedc")}exports.who = me;\nexports.viaMixedC = function () {\n  return me + ":" + ++calls + " > " + state.bump();\n};\n`,
  "barrel.js": `export * from "./state.js";\nexport { bump as bumpC } from "./statec.cjs";\nexport { viaUser } from "./user.js";\n`,
  "lazy.js": `${born("lazy")}export const who = me;\nexport async function viaLazy() {\n  return me + ":" + ++calls + " > " + (await import("./state.js")).bump();\n}\nexport function viaLazyC() {\n  return me + ":" + ++calls + " > " + require("./statec.cjs").bump();\n}\n`,
};
const names = Object.keys(files);

const evictions: ((file: string) => string)[] = [
  file => `delete require.cache[require.resolve("./${file}")];`,
  file => `delete require.cache[require.resolve("./${file}")];`,
  file => `delete require.cache[require.resolve(made("./${file}"))];`,
  file => `delete require.cache[Bun.resolveSync("./${file}", import.meta.dir)];`,
  file => `for (const key in require.cache) if (key.endsWith("/${file}")) delete require.cache[key];`,
];
const loads: ((file: string, step: number) => string)[] = [
  file => `keep("required ${file}", require("./${file}"));`,
  file => `keep("required ${file}", require("./${file}"));`,
  file => `keep("imported ${file}", await import("./${file}"));`,
  file => `keep("imported ${file}", await import("./${file}"));`,
  (file, step) => `keep("imported ${file}?${step}", await import("./${file}?${step}"));`,
  (file, step) => `keep("imported ${file}?${step}", await import("./${file}?" + ${step}));`,
  file => `keep("imported ${file} by a made name", await import(made("./${file}")));`,
  file => `keep("required ${file} by a made name", require(made("./${file}")));`,
];

export function generate(random: Random): { text: string; files: Record<string, string>; extension: "js" | "ts" } {
  const upFront = names.filter(() => random.chance(0.45));
  const imports = upFront.map((file, index) => `import * as upFront${index} from "./${file}";`);
  const steps: string[] = [];
  const count = random.between(1, 5);
  for (let step = 0; step < count; step++) {
    const lines: string[] = [];
    if (random.chance(0.75)) for (const file of random.sample(names, random.pick([1, 1, 1, 2, 3]))) lines.push(random.pick(evictions)(file));
    if (random.chance(0.06)) lines.push("for (const key in require.cache) delete require.cache[key];");
    for (const file of random.sample(names, random.pick([1, 1, 2]))) lines.push(random.pick(loads)(file, step));
    steps.push(`try {\n  ${lines.join("\n  ")}\n  } catch (error) {\n    say("${step} threw " + error.constructor.name + ": " + short(error.message));\n  }\n  await ask("${step}");`);
  }
  const opensTheWorld = random.pick(["", "", "", "", 'spyOn(process, "exit").mockImplementation(() => {});\n', "globalThis.structuredClone = value => value;\n"]);
  const body = `await ask("at first");\n  ${steps.join("\n  ")}`;
  const text = `import { spyOn, test } from "bun:test";
${imports.join("\n")}
const say = console.log.bind(console);
const short = text => String(text).replace(/\\/[^ '"]*\\//g, "").slice(0, 90);
function made(name) {
  let text = "";
  for (let i = 0; i < name.length; i++) text += name[i];
  return text;
}
const kept = [${upFront.map((file, index) => `["up front ${file}", upFront${index}]`).join(", ")}];
const keep = (label, module) => kept.push([label, module]);
async function ask(label) {
  const answers = [];
  for (const [name, module] of kept)
    for (const key of Object.keys(module).sort()) {
      if (key === "default") continue;
      let text;
      try {
        text = typeof module[key] === "function" ? String(await module[key]()) : String(module[key]);
      } catch (error) {
        text = "throws " + error.constructor.name;
      }
      answers.push(name + "." + key + " = " + text);
    }
  say(label + "\\n  " + answers.join("\\n  "));
}
${opensTheWorld}${random.chance(0.6) ? `test("steps", async () => {\n  ${body}\n});` : body}
`;
  return { text, files: { ...files }, extension: random.chance(0.7) ? "js" : "ts" };
}
