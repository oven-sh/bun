// `Object.assign({ label: i }, { a: 1, b: 2, 0: "zero", 1: "one" })` and `{ ...source }`: records that hold elements beside their
// names. A run time may copy the fields by a plan and the elements as a block of storage, as long as nothing can see a store. Each
// scene varies what that rests on: the source (holes, keys that only look like indexes, getters, hidden and symbol keys, names
// outside a declared type), the target (its own elements, setters of its own or inherited, frozen, a proxy, a list, a view), the way
// to copy, and what is asked afterwards: the order of keys, descriptors, and whether source and copy share anything.
import type { Random } from "./random";

const sources = [
  '{ a: 1, b: 2, 0: "zero", 1: "one" }',
  '{ a: 1, b: 2, 0: "zero", 1: "one" }',
  '{ a: 1, b: 2, 0: "zero", 1: "one" }',
  '{ 0: "zero", 1: "one" }',
  "{ a: 1, b: 2 }",
  "{ a: 1, 0: 10, 1: 20, 2: 30 }",
  "{ a: 1.5, 0: 0.5, 1: 1.5 }",
  '{ a: 1, 5: "five" }',
  '{ a: 1, 1: "one", b: 2, 0: "zero" }',
  '{ a: 1, [word("2")]: "two", 0: "zero" }',
  '{ a: 1, 4294967294: "last index", 4294967295: "no index" }',
  '{ "-1": "minus", "01": "padded", 1.5: "fraction", a: 1, 0: "zero" }',
  "{ 0: { deep: 1 }, a: { deep: 2 } }",
  '{ a: 1, [tag]: "symbol", 0: "zero" }',
  "{ a: undefined, 0: undefined, 1: null }",
  `JSON.parse('{"a":1,"b":2,"0":"zero","extra":3}')`,
  `JSON.parse('{"a":1,"extra":3,"more":[1],"other":"x","b":2}')`,
  `JSON.parse('{"7":"seven","0":"zero","a":1}')`,
  'Object.assign(Object.create(null), { a: 1, 0: "zero" })',
  '{ a: 1, get 0() { seen.push("get 0"); return "got"; }, 1: "one" }',
  '{ get a() { seen.push("get a"); return 1; }, 0: "zero" }',
  '{ a: 1, 0: "zero", get b()$A { seen.push("get b"); delete (this$C)[1]; return 2; }, 1: "one" }',
  'Object.defineProperty({ a: 1, 0: "zero" }, 1, { value: "hidden", enumerable: false })',
  'Object.defineProperty({ 0: "zero", 1: "one" }, "a", { value: "hidden", enumerable: false })',
  'Object.freeze({ a: 1, 0: "zero" })',
  "[1, 2, 3]",
  "[1, , 3]",
  "Object.assign([1, 2], { a: 1 })",
  '"text"',
  "new Uint8Array([7, 8])",
  "new Row(i)",
  "many()",
  "sparse()",
  "null",
  "undefined",
  "5",
];

const targets = [
  "{}",
  "{}",
  "{ label: i }",
  "{ label: i }",
  '{ label: i, a: "old" }',
  '{ 0: "own zero" }',
  '{ label: i, 0: "own", 5: "five" }',
  '{ label: i, 9: "nine" }',
  '{ set 0(value$A) { seen.push("set 0 " + String(value)); } }',
  '{ label: i, set a(value$A) { seen.push("set a " + String(value)); } }',
  'Object.create({ set 0(value$A) { seen.push("inherited set 0"); } })',
  'Object.create({ set a(value$A) { seen.push("inherited set a"); } })',
  'Object.create({ 0: "inherited", a: "inherited" })',
  'Object.create(Object.freeze({ 0: "inherited and fixed" }))',
  "Object.freeze({ label: 1 })",
  "Object.preventExtensions({ label: 1 })",
  "Object.seal({ a: 0, 0: 0 })",
  'Object.defineProperty({}, 0, { value: "fixed", writable: false, configurable: true })',
  'Object.defineProperty({}, "a", { value: "fixed", writable: false, configurable: true })',
  "[]",
  "[9, 9, 9]",
  "new Row(i)",
  "new Uint8Array(2)",
  'new Proxy({}, { set(target$A, key$A, value$A, receiver$A) { seen.push("trap " + String(key)); return Reflect.set(target, key, value, receiver); } })',
  "Object.create(null)",
];

const copies = [
  "Object.assign(TARGET, source)",
  "Object.assign(TARGET, source)",
  "Object.assign(TARGET, source)",
  "Object.assign(TARGET, source, second)",
  "Object.assign(TARGET, second, source)",
  "Object.assign(Object.assign(TARGET, source), source)",
  "{ ...source }",
  "{ ...source }",
  "{ label: i, ...source }",
  '{ ...source, a: "after" }',
  '{ ...source, 0: "after" }',
  '{ 0: "before", ...source }',
  "{ ...source, ...second }",
  "{ ...second, ...source }",
  "(({ a, ...rest }$A) => rest)(source)",
  "(({ 0: first, ...rest }$A) => rest)(source)",
  "Object.fromEntries(Object.entries(source))",
];

const asks = [
  "Object.keys(made).join()",
  "Object.keys(made).join()",
  "JSON.stringify(made)",
  "JSON.stringify(made)",
  "Reflect.ownKeys(made).map(String).join()",
  "made[0]",
  "made[1]",
  "made.a",
  'made[word("0")]',
  'Object.entries(made).join("|")',
  "0 in made",
  "Object.hasOwn(made, 0)",
  "Object.hasOwn(made, 1)",
  "JSON.stringify(Object.getOwnPropertyDescriptor(made, 0))",
  'JSON.stringify(Object.getOwnPropertyDescriptor(made, "a"))',
  "namesIn(made)",
  "Object.values(made).length",
  "made.length",
  "made === source",
  '(made[0] = "written to the copy", String(source[0]))',
  '(source[0] = "written to the source", String(made[0]))',
  '(source[1] = "written to the source", source.a = "too", JSON.stringify(made))',
  "(made[7] = 1, Object.keys(made).join())",
  "(delete made[0], Object.keys(made).join())",
  "(made.z = 1, made[2] = 2, Reflect.ownKeys(made).map(String).join())",
  "made[0] === source[0]",
  "JSON.stringify({ ...made })",
  "JSON.stringify(source)",
];

export function generate(random: Random, typed: boolean): string {
  const any = typed ? ": any" : "";
  const fill = (code: string) => code.replaceAll("$A", any).replaceAll("this$C", typed ? "this as any" : "this");
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 7); scene < total; scene++) {
    const isPlain = random.chance(0.35);
    const source = fill(isPlain ? random.pick(sources.slice(0, 9)) : random.pick(sources));
    const second = fill(random.pick(sources.slice(0, 18)));
    const target = fill(isPlain ? random.pick(targets.slice(0, 8)) : random.pick(targets));
    const copy = fill(isPlain ? random.pick([...copies.slice(0, 3), ...copies.slice(6, 9)]) : random.pick(copies));
    const asked = random.sample(asks, random.between(2, 5));
    const isDeclared = typed && random.chance(0.5);
    const turns = random.pick([4, 30, 300, 2500]);
    scenes.push(`function copy${scene}(i${typed ? ": number" : ""}) {
  seen.length = 0;
  const source${isDeclared ? ": Shape" : any} = ${isDeclared ? `(${source}) as any` : source};
  const second${any} = ${second};
  const made${any} = ${copy.replace("TARGET", typed ? `(${target}) as any` : target)};
  const said = [${asked.map(ask => `told(() => ${isDeclared ? ask.replace(/\bsource\b/g, "(source as any)") : ask})`).join(", ")}];
  return said.join(" ; ") + " # " + seen.join();
}
{
  let hash = 0;
  let last = "";
  for (let i = 0; i < ${turns}; i++) {
    try {
      last = copy${scene}(i);
    } catch (error) {
      last = "threw " + ${typed ? "(error as Error).name" : "error.name"} + " # " + seen.join();
    }
    for (let at = 0; at < last.length; at++) hash = (hash * 31 + last.charCodeAt(at)) | 0;
  }
  console.log("scene ${scene}", hash, last);
}`);
  }
  return `const word${typed ? ": (text: string) => string" : ""} = Function("text", "return text")${
    typed ? " as (text: string) => string" : ""
  };
const tag = Symbol("tag");
const seen${typed ? ": string[]" : ""} = [];
${typed ? "interface Shape {\n  a?: any;\n  b?: any;\n}\n" : ""}class Row {
  ${typed ? "[index: number]: any;\n  " : ""}a${any} = 1;
  constructor(i${typed ? ": number" : ""}) {
    this[0] = i;
    this[1] = "row";
  }
}
function many() {
  const made${typed ? ": Record<string, number>" : ""} = { a: 1 };
  for (let at = 0; at < 40; at++) made[at] = at;
  return made;
}
function sparse() {
  const made${typed ? ": Record<string, number>" : ""} = { a: 1 };
  for (let at = 0; at < 5; at++) made[at * 100000] = at;
  return made;
}
function namesIn(given${any}) {
  const names = [];
  for (const name in given) names.push(name);
  return names.join();
}
function told(ask${typed ? ": () => unknown" : ""}) {
  try {
    return String(ask());
  } catch (error) {
    return "threw " + ${typed ? "(error as Error).name" : "error.name"};
  }
}
${scenes.join("\n")}
${typed ? "export {};\n" : ""}`;
}
