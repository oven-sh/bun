// `all = { ...all, [key]: value }`: an object used as a dictionary grows by a copy of itself and one more key. The copy may be
// made in one step, with room for what follows. Each scene grows such a dictionary over 0 to 300 steps, with keys that repeat,
// look like indexes, are "__proto__", symbols or long, in one of several forms of the literal, by a loop or by reduce. In a few
// steps the source is something else, or is changed, frozen or given a getter first. Earlier copies are kept and must stay as
// they were. At the end the order of the keys, the values and the kept copies are printed.
import type { Random } from "./random";

/** Expressions for the key of step `i`. */
const keys = [
  '"k" + i',
  '"k" + i',
  '"k" + (i % 3)',
  '"k" + (i % 7)',
  "String(i)",
  "String(9 - (i % 10))",
  'i % 2 ? "k" + i : String(i)',
  '"0" + i',
  "names[i % names.length]",
  'i === 2 ? "__proto__" : "k" + i',
  '"long-key-".repeat(8) + i',
  '"constructor"',
  '["a", "b", "c", "a"][i % 4]',
  '"-" + i',
  "String(i * 1000003)",
];

const values = ["i", "i / 4", '"v" + i', "{ n: i }", "[i]", "undefined", "null", "i % 2 === 0", 'i % 3 ? i : "text"'];

/** Expressions for the next dictionary. */
const steps = [
  "{ ...all, [key]: value }",
  "{ ...all, [key]: value }",
  "{ ...all, [key]: value }",
  "{ [key]: value, ...all }",
  "{ ...all, [key]: value, last: i }",
  "{ ...all, ...{ [key]: value } }",
  "{ ...all, ...other, [key]: value }",
  "{ ...all }",
  "Object.assign({}, all, { [key]: value })",
  "{ ...{ ...all }, [key]: value }",
  '{ ...all, [key]: value, [key + "x"]: value }',
];

/** Statements that run in the rare step, before the copy. `raw` is the dictionary without its type. */
const changes = [
  "",
  "",
  "",
  "kept.push(all);",
  "kept.push(all);",
  "delete raw[key];",
  'delete raw["k0"];',
  "Object.freeze(all);",
  "Object.seal(all);",
  'Object.defineProperty(raw, "hidden", { value: 1, enumerable: false, configurable: true });',
  'Object.defineProperty(raw, "got", { get: () => (log.push("getter"), 7), enumerable: true, configurable: true });',
  'raw[Symbol.for("s")] = i;',
  "Object.setPrototypeOf(raw, { inherited: 1 });",
  "Object.setPrototypeOf(raw, null);",
  "all = CAST(Object.create(all));",
  'all = CAST(new Proxy(all, { ownKeys: target => (log.push("ownKeys"), Reflect.ownKeys(target)) }));',
  "all = CAST([i, i + 1]);",
  'all = CAST("st");',
  "all = CAST(null);",
  "all = CAST(new Pair(i));",
  'all = CAST(JSON.parse(\'{"parsed":1,"2":2}\'));',
  'all = CAST(new Map([["m", 1]]));',
  'for (let n = 0; n < 70; n++) raw["fill" + n] = n;',
  'raw[key] = "stored first";',
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 6); scene < total; scene++) {
    const count = random.pick([0, 1, 2, 5, 8, 40, 300]);
    const when = random.pick(["i === 1", "i === 3", "i === count - 1", "i % 13 === 5", "false", "false"]);
    const change = random.pick(changes).replaceAll("CAST(", typed ? "cast(" : "(");
    const step = random.pick(steps);
    const body = `const key${as("string")} = ${random.pick(keys)};
    const value${as("unknown")} = ${random.pick(values)};
    const raw${as("any")} = all;
    if (${when}) {
      ${change}
    }`;
    const isReduced = random.chance(0.3) && !change.includes("all = ");
    scenes.push(`function scene${scene}(count${as("number")}, other${as("Dictionary")})${as("string")} {
  ${
    isReduced
      ? `const grown = Array.from({ length: count }, (_, i) => i).reduce((all${as("Dictionary")}, i${as("number")})${as("Dictionary")} => {
    ${body}
    return ${step};
  }, ${random.pick(["{}", "{}", "{ first: 0 }"])}${typed ? " as Dictionary" : ""});`
      : `let all${as("Dictionary")} = ${random.pick(["{}", "{}", "{ first: 0 }", '{ k0: "there", k1: "already" }'])};
  for (let i = 0; i < count; i++) {
    ${body}
    all = ${step};
  }
  const grown = all;`
  }
  return described(grown);
}
console.log("scene ${scene}", told(() => scene${scene}(${count}, ${random.pick(["{}", "{ z: 1 }", '{ k1: "of the other" }'])})), "| kept", kept.splice(0).map(described).join(" ; "), "| log", log.length, log.splice(0)[0]);`);
  }
  return `${typed ? "type Dictionary = { [key: string]: unknown };\nconst cast = (value: unknown) => value as Dictionary;\n" : ""}const kept${as("Dictionary[]")} = [];
const log${as("string[]")} = [];
const names = ["alpha", "beta", "1", "gamma", "alpha", "0"];
class Pair {
  a${as("number")};
  b = 2;
  constructor(a${as("number")}) {
    this.a = a;
  }
  get c() {
    return 3;
  }
}
// The keys in their order, the first and the last few with their values, and how long it all is.
function described(it${as("any")})${as("string")} {
  if (it === null || typeof it !== "object") return String(it);
  const listed = Reflect.ownKeys(it);
  let text = "";
  for (let at = 0; at < listed.length; at++) text += String(listed[at]) + "=" + JSON.stringify(it[listed[at]]) + ",";
  return listed.length + ":" + (text.length > 160 ? text.slice(0, 80) + ".." + text.length + ".." + text.slice(-60) : text) + (Object.getPrototypeOf(it) === Object.prototype ? "" : " other prototype");
}
function told(ask${as("() => string")})${as("string")} {
  try {
    return ask();
  } catch (error) {
    return "threw " + ${typed ? "(error as Error)" : "error"}.name;
  }
}
${scenes.join("\n")}
${typed ? "export {};\n" : ""}`;
}
