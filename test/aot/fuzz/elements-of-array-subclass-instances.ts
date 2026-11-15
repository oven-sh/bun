// An object of a class that extends Array is read and written by index, walked with for-of, taken apart by a list pattern
// and spread. Each scene picks who makes the object, what its elements are, and one or two changes that make a shortcut
// wrong: a hole, a far store, another kind of element, a frozen object, an accessor under an index on the object or on
// the class's prototype, an iterator of its own, another prototype. Every answer is printed.
import type { Random } from "./random";

/** Expressions for a list of class NAME that holds ELEMENTS. */
const makers = [
  "new NAME(ELEMENTS)",
  "NAME.of(ELEMENTS)",
  "NAME.from([ELEMENTS])",
  "Reflect.construct(NAME, [ELEMENTS])",
  "filled(new NAME(), [ELEMENTS])",
  "NAME.of(ELEMENTS).map(item => item)",
  "NAME.of(ELEMENTS).slice()",
  "NAME.of(ELEMENTS).filter(() => true)",
  "NAME.of(ELEMENTS).concat([])",
  "Object.setPrototypeOf([ELEMENTS], NAME.prototype)",
  "new BelowNAME(ELEMENTS)",
];

const elements = ["1, 2, 3, 4", "1.5, 2.5, 3.5, 4.5", "1, 2.5, 3, 4", "7, 8", "0, -0, 2147483647, -2147483648", "1, 2, 3, 4, 5, 6, 7, 8, 9"]; // prettier-ignore

/** Statements that change `raw`, the list seen without its type, or PROTO, the prototype object of its class NAME. */
const changes = [
  "delete raw[1];",
  "raw.length = 1;",
  "raw.length = 6;",
  "raw[raw.length + 2] = 9;",
  "raw[5000] = 9;",
  'raw[1] = "text";',
  "raw[1] = 0.5;",
  "raw[0] = { valueOf: () => 40 };",
  "raw[1] = undefined;",
  "raw.push(0.25);",
  'raw.push("last");',
  "raw.shift();",
  "raw.reverse();",
  "Object.freeze(raw);",
  "Object.seal(raw);",
  "Object.preventExtensions(raw);",
  'Object.defineProperty(raw, "1", { get: () => 100, configurable: true });',
  'Object.defineProperty(raw, "0", { value: 50, writable: false, configurable: true });',
  'delete raw[1];\nObject.defineProperty(PROTO, "1", { get: () => 200, set() {}, configurable: true });',
  "delete raw[2];\nPROTO[2] = 300;",
  "raw[Symbol.iterator] = function* () {\n  yield 70;\n  yield 71;\n};",
  "PROTO[Symbol.iterator] = function* () {\n  yield 80;\n};",
  "Object.setPrototypeOf(raw, Array.prototype);",
  "Object.setPrototypeOf(raw, { __proto__: NAME.prototype, 1: 400 });\ndelete raw[1];",
  'raw.extra = "added";',
  'Object.defineProperty(raw, "length", { writable: false });',
];

/** Function bodies that use `list`, of class NAME, and return what they saw. */
const uses = [
  "let sum = 0;\nfor (let i = 0; i < list.length; i++) sum += list[i];\nreturn sum;",
  'let seen = "";\nfor (let i = 0; i < list.length + 1; i++) seen += list[i] + ";";\nreturn seen;',
  "let sum = 0;\nfor (const item of list) sum += item;\nreturn sum;",
  'let seen = "";\nfor (const item of list) seen += item + ";";\nreturn seen;',
  'let seen = "";\nfor (const item of list) {\n  seen += item + ";";\n  if (list.length < 7) list.push(1);\n}\nreturn seen;',
  'let seen = "";\nfor (const item of list) {\n  seen += item + ";";\n  list.length = 2;\n}\nreturn seen;',
  'const [a, b] = list;\nreturn a + ";" + b;',
  'const [a, , c = 5, ...rest] = list;\nreturn a + ";" + c + ";" + rest.length;',
  'return list[0] + ";" + list[1] + ";" + list[list.length - 1] + ";" + list[list.length] + ";" + list[-1];',
  "for (let i = 0; i < list.length; i++) list[i] = i + 1;\nreturn show(list);",
  "for (let i = 0; i < list.length; i++) list[i] = i + 0.5;\nreturn show(list);",
  "for (let i = 0; i < 6; i++) list[i] = i;\nreturn show(list);",
  "list[1] = 11;\nlist[0] = list[1] + 1;\nreturn show(list);",
  "list[list.length] = 12;\nreturn show(list);",
  "return [...list].length + Math.max(...list);",
  'return (1 in list) + ";" + (list.length in list) + ";" + list.length;',
  "return list.total();",
  "return list.first();",
  "return list.pair();",
  "return list.fillUp();",
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(2, 4); scene < total; scene++) {
    const name = `L${scene}`;
    const named = (text: string) => text.replaceAll("NAME", name).replaceAll("PROTO", `proto${scene}`);
    const made = named(random.pick(makers)).replace("ELEMENTS", random.pick(elements));
    const maker = typed ? `(${made}) as ${name}` : made;
    const picked = random.sample(uses, random.between(1, 3));
    const steps = random.sample(changes, random.between(0, 2)).map(named);
    const calls = random.pick([1, 1, 3, 300]);
    const isChangedFirst = random.chance(0.6);
    const used = picked.map((_, at) => `told(() => use${scene}_${at}(list))`).join(", ");
    const change = steps.length ? `told(() => {\n    ${steps.join("\n").replaceAll("\n", "\n    ")}\n  });` : "";
    scenes.push(`class ${name} extends Array${typed ? "<number>" : ""} {
  total()${as("number")} {
    let sum = 0;
    for (let i = 0; i < this.length; i++) sum += this[i];
    return sum;
  }
  first()${as("number")} {
    for (const item of this) return item;
    return -1;
  }
  pair()${as("string")} {
    const [a, b] = this;
    return a + ";" + b;
  }
  fillUp()${as("string")} {
    for (let i = 0; i < this.length; i++) this[i] = this[i] + 1;
    return show(this);
  }
}
class Below${name} extends ${name} {}
const proto${scene}${as("any")} = ${name}.prototype;
${picked.map((use, at) => `function use${scene}_${at}(list${as(name)})${as("unknown")} {\n  ${use.replaceAll("\n", "\n  ")}\n}`).join("\n")}
${calls > 1 ? `for (let call = 1; call < ${calls}; call++) {\n  const list${as(name)} = ${maker};\n  [${used}];\n}\n` : ""}{
  const list${as(name)} = ${maker};
  const raw${as("any")} = list;
  ${isChangedFirst ? change : ""}
  console.log("scene ${scene}", ${used});
  ${isChangedFirst ? "" : `${change}\n  console.log("scene ${scene} again", ${used});`}
  console.log("scene ${scene} ends", told(() => show(raw)), raw instanceof ${name}, Array.isArray(raw));
}`);
  }
  return `function show(list${as("any")})${as("string")} {
  const seen = [];
  for (let i = 0; i < Math.min(list.length, 12); i++) seen.push(i in list ? typeof list[i] + " " + String(list[i]) : "hole");
  return list.length + ": " + seen.join() + " | " + Object.keys(list).slice(-3).join();
}
function told(ask${as("() => unknown")})${as("unknown")} {
  try {
    const answer = ask();
    return Object.is(answer, -0) ? "-0" : answer;
  } catch (error) {
    return "threw " + ${typed ? "(error as Error)" : "error"}.name;
  }
}
function filled(list${as("any")}, items${as("number[]")})${as("any")} {
  for (const item of items) list.push(item);
  return list;
}
${scenes.join("\n")}
`;
}
