// The program writes object literals and hands them out. Text that is evaluated at run time writes literals that begin with the same members, in the same order or another, and go on with
// accessors, spreads, computed keys, indexes and prototypes. Then the text and the program change those objects in turns, the program reads them where it reads its own, and makes its own again.
// Each object is printed with its keys, attributes, prototype, level of integrity, what for-in lists and what JSON makes of it.
import type { Random } from "./random";

const names = ["first", "second", "third", "!", "a b", "length", "name", "constructor"] as const;
const values = [
  "1",
  "1.5",
  '"text"',
  "undefined",
  "null",
  "{ inner: 1 }",
  "[1, 2]",
  "() => 1",
  "2147483648",
  "-0",
  "true",
  "NaN",
] as const;
const prototypes = ["base", "null", "Uint16Array", "[]", "Object.prototype", "handed"] as const;

const keys = [
  '"later"',
  "42",
  '"42"',
  '"first"',
  'Symbol.for("key")',
  "1.5",
  "-1",
  '"__proto__"',
  "4294967294",
  "4294967295",
  '""',
] as const;
const spreads = [
  "{ later: 1 }",
  '{ 42: "spread" }',
  '[1.5, , "text"]',
  '"ab"',
  "handed[0]",
  "null",
  '{ get first() { return "from a getter"; } }',
  "new Proxy({ a: 1, 3: 2 }, {})",
  "Object.create({ unseen: 1 }, { seen: { value: 1, enumerable: true }, hidden: { value: 2 } })",
] as const;

// What follows the members that a literal of the text shares with one of the program. NAME is one of those members.
const tails = [
  "get 42() { return this.NAME; }",
  "set 42(value) { this.NAME = value; }",
  "get 0() { return 0; }",
  "set 0(value) {}",
  "get [key]() { return 7; }",
  "set [key](value) {}",
  "[key]: 2",
  "[key]() { return 3; }",
  "...spread",
  '...[1.5, , "text"]',
  "...handed[0]",
  "__proto__: base",
  "__proto__: null",
  "__proto__: handed[0]",
  '["__proto__"]: 1',
  "__proto__() { return 4; }",
  "42: 5",
  "[7]: 1.5",
  '4294967294: "last"',
  '4294967295: "name"',
  '"-1": 1',
  "1.5: 1",
  'get NAME() { return "getter"; }',
  "set NAME(value) {}",
  "NAME: 2",
  "42() { return super.inherited; }",
  "later() { return super.NAME; }",
  'get [Symbol.toStringTag]() { return "tag"; }',
  '[Symbol.for("s")]: 1',
  "async *[key + 1]() {}",
  "get other() { return this.NAME; }",
  "set other(value) { this[42] = value; }",
] as const;

// What is done to such an object afterwards, by the text or by the program.
const steps = [
  'made[0] = 1; made[1] = 1.5; made[3] = "text";',
  "made[1000000] = 1; made[4294967294] = 2; made[4294967295] = 3; made[-1] = 4;",
  "Object.defineProperty(made, 3, { value: 1, enumerable: false, configurable: true });",
  "Object.defineProperty(made, 3, { get() { return this.NAME; }, enumerable: true });",
  'Object.defineProperty(made, "NAME", { get() { return 8; }, configurable: true });',
  'Object.defineProperty(made, "NAME", { writable: false });',
  'Object.defineProperty(made, "NAME", { enumerable: false });',
  "made.__defineGetter__(42, () => 9);",
  'made.__defineSetter__("NAME", () => {});',
  "delete made.NAME;",
  "delete made[42];",
  "for (const each in made) delete made[each];",
  "Object.freeze(made);",
  "Object.seal(made);",
  "Object.preventExtensions(made);",
  "Object.setPrototypeOf(made, base);",
  "Object.setPrototypeOf(made, null);",
  "Object.setPrototypeOf(made, []);",
  "made.__proto__ = handed[0];",
  "Object.setPrototypeOf(Object.create(null), made);",
  'const heir = Object.create(made); heir.NAME = 5; heir[42] = 6; show("heir", heir);',
  'Object.assign(made, { NAME: "assigned", 42: "assigned", more: 1 });',
  "Object.assign(made, handed[0]);",
  "made.NAME = 1.5;",
  'made.NAME = "another kind";',
  "made.NAME = made;",
  'for (let more = 0; more < 70; more++) made["m" + more] = more;',
  "Array.prototype.push.call(made, 1, 2);",
  "Array.prototype.reverse.call(made);",
  "Array.prototype.sort.call(made);",
  "made.later = 1; delete made.later; made.later = 2;",
  'made[Symbol.iterator] = function* () { yield this.NAME; }; show("spread", { list: [...made] });',
  'show("copy", { ...made });',
  'show("cloned", structuredClone(made));',
  'show("parsed", JSON.parse(JSON.stringify(made)));',
  'show("entries", Object.fromEntries(Object.entries(made)));',
  'show("branded", new Branded(made));',
  "handed.push(made);",
  "handed[0] = made;",
] as const;

const prelude = (any: string, list: string) => `const base${any} = { inherited: "from base" };
const handed${list} = [];
function told(run${any && ": () => any"}) {
  try {
    return run();
  } catch (error${any}) {
    return "threw " + error?.constructor?.name;
  }
}
function describe(value${any})${any && ": string"} {
  if (typeof value === "function") return "function";
  if (typeof value === "symbol") return String(value);
  if (typeof value === "object" && value !== null) return Array.isArray(value) ? "[" + value.map(describe) + "]" : "object";
  return typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value);
}
function show(label${any}, object${any}) {
  const parts = [];
  for (const key of Reflect.ownKeys(object).slice(0, 24)) {
    const property${any} = Reflect.getOwnPropertyDescriptor(object, key);
    const flags = (property.writable ? "w" : "") + (property.enumerable ? "e" : "") + (property.configurable ? "c" : "");
    const held = "value" in property ? describe(property.value) : (property.get ? "get" : "") + (property.set ? "set" : "");
    parts.push(describe(key) + ":" + held + ":" + flags + ":" + told(() => describe(object[key])));
  }
  const prototype = Object.getPrototypeOf(object);
  const above = prototype === Object.prototype ? "Object.prototype" : prototype === base ? "base" : prototype === null ? "null" : Array.isArray(prototype) ? "a list" : "another";
  const level = Object.isFrozen(object) ? "frozen" : Object.isSealed(object) ? "sealed" : Object.isExtensible(object) ? "open" : "closed";
  const listed = [];
  for (const key in object) if (listed.length < 24) listed.push(key);
  console.log(label, "|", Reflect.ownKeys(object).length, parts.join(" "), "|", above, level, "|", listed.join(), "|", told(() => String(JSON.stringify(object)).slice(0, 300)));
}
class Returned {
  constructor(given${any}) {
    return given;
  }
}
class Branded extends Returned {
  #brand = 1;
  static has(value${any}) {
    return #brand in value;
  }
}
`;

export function generate(random: Random, typed: boolean): string {
  const any = typed ? ": any" : "";
  const text: string[] = [prelude(any, typed ? ": any[]" : "")];
  const records = Array.from({ length: random.between(1, 3) }, (_, index) => {
    const members = random.sample(names, random.weighted([[4, 1], [4, 2], [2, 3], [1, 4]])); // prettier-ignore
    const above = random.chance(0.6) ? random.pick(prototypes) : undefined;
    return {
      index,
      members,
      above: above === "handed" && index === 0 ? "base" : above === "handed" ? "handed[0]" : above,
    };
  });
  const quoted = (name: string) => (/^[a-z]+$/.test(name) ? name : JSON.stringify(name));
  const reach = (name: string) => (/^[a-z]+$/.test(name) ? `.${name}` : `[${JSON.stringify(name)}]`);
  const named = (line: string, name: string) =>
    line
      .replace(/(this|made|heir|super)\.NAME/g, (_, on) => on + reach(name))
      .replace(/"NAME"/g, JSON.stringify(name))
      .replace(/NAME/g, quoted(name));
  for (const { index, members, above } of records) {
    const given = members.map((_, at) => `v${at}${any}`).join(", ");
    const inside = members.map((name, at) => `${quoted(name)}: v${at}`);
    if (above) inside.splice(random.between(0, inside.length), 0, `__proto__: ${above}`);
    text.push(`function make${index}(${given})${any} {\n  return { ${inside.join(", ")} };\n}`);
    const call = `make${index}(${members.map(() => random.pick(values)).join(", ")})`;
    text.push(
      random.pick([
        `handed.push(${call});`,
        `handed.push(${call});\nReflect.set(globalThis, "out${index}", handed.at(-1));`,
        `handed.push((0, eval)("given => given")(${call}));`,
        `handed.push(${call});\nshow("handed out ${index}", handed.at(-1));`,
      ]),
    );
    text.push(
      `function read${index}(given${any}) {\n  return [${members.map(name => `describe(given${reach(name)})`).join(", ")}].join();\n}`,
    );
  }
  // A walk over a list goes by `length`, which may hold two thousand million.
  const fitting = records.some(({ members }) => members.includes("length"))
    ? steps.filter(line => !/reverse|sort/.test(line))
    : steps;
  const scenes = random.between(2, 5);
  for (let scene = 0; scene < scenes; scene++) {
    const record = random.pick(records);
    const name = random.pick(record.members);
    // Every third scene takes much of everything: what is drawn apart seldom meets.
    const much = scene % 3 === 0;
    const order = random.weighted([[5, "same"], [2, "fewer"], [1, "another order"], [1, "more in front"]] as const); // prettier-ignore
    const shared =
      order === "fewer"
        ? record.members.slice(0, random.between(1, record.members.length))
        : order === "another order"
          ? random.shuffled(record.members)
          : record.members;
    const front = shared.map(member => `${quoted(member)}: ${random.pick(values)}`);
    if (order === "more in front") front.unshift("before: 1");
    const tail = random
      .sample(tails, much ? random.between(3, 5) : random.between(0, 2))
      .map(line => named(line, name));
    const mine = random
      .sample(fitting, much ? random.between(2, 4) : random.between(0, 2))
      .map(line => named(line, name));
    const byProgram = mine.map(() => random.chance(0.4));
    const compiled = mine.filter((_, at) => byProgram[at]);
    text.push(
      `const steps${scene}${typed ? ": ((made: any) => void)[]" : ""} = [${compiled.map(line => `made => {\n  ${line}\n}`).join(", ")}];`,
    );
    const lines = [
      `const made = { ${[...front, ...tail].join(", ")} };`,
      `show("scene ${scene}", made);`,
      `console.log("read", told(() => read(made)));`,
    ];
    let next = 0;
    mine.forEach((line, at) => {
      lines.push(
        `console.log("step ${at}", told(() => {\n${byProgram[at] ? `steps[${next++}](made);` : line}\n}));`,
        `show("scene ${scene} step ${at}", made);`,
      );
    });
    lines.push(`console.log("read", told(() => read(made)), told(() => Branded.has(made)));`, `return made;`);
    const body = lines.join("\n");
    const parameters = ["show", "told", "base", "handed", "key", "spread", "steps", "read", "Branded"];
    const given = `show, told, base, handed, key${scene}, spread${scene}, steps${scene}, read${record.index}, Branded`;
    text.push(
      `const key${scene}${any} = process.argv.length > 99 ? "never" : ${random.pick(keys)};`,
      `const spread${scene}${any} = ${random.pick(spreads)};`,
    );
    const way = random.weighted([[3, "indirect"], [3, "Function"], [2, "direct"], [1, "joined"]] as const); // prettier-ignore
    const whole = `(function (${parameters.join(", ")}) {\n${body}\n})`;
    const evaluated =
      way === "indirect"
        ? `(0, eval)(${JSON.stringify(whole)})(${given})`
        : way === "Function"
          ? `new Function(${parameters.map(parameter => JSON.stringify(parameter)).join(", ")}, ${JSON.stringify(body)})(${given})`
          : way === "direct"
            ? `(function ()${any} {\n  return eval(${JSON.stringify(whole)});\n})()(${given})`
            : `(0, eval)(${JSON.stringify(whole.slice(0, whole.length >> 1))} + [${JSON.stringify(whole.slice(whole.length >> 1))}].join(""))(${given})`;
    text.push(`const made${scene}${any} = told(() => ${evaluated});`);
    text.push(
      `console.log("behind scene ${scene}", typeof made${scene} === "string" ? made${scene} : told(() => read${record.index}(made${scene})));`,
    );
    const again = random.pick(records);
    text.push(
      `show("made again ${scene}", make${again.index}(${again.members.map(() => random.pick(values)).join(", ")}));`,
    );
    if (random.chance(0.4))
      text.push(`for (const each of handed) console.log("handed", told(() => read${again.index}(each)));`);
  }
  text.push(`for (const each of handed) show("at the end", each);`);
  return text.join("\n") + "\n";
}
