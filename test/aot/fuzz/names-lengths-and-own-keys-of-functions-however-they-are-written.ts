// Functions and classes of every kind, written in every place that gives a name or gives none, and what they show of themselves.
//
//   kinds       functions, arrows, async functions and arrows, generators, async generators, classes, classes below others, methods, getters, setters, static members, private methods handed out,
//               bound functions, bound twice, proxies, `new Function`, built-ins
//   places      declarations, `const`, `let`, `var`, assignments, `||=`, `&&=`, `??=`, defaults of parameters and of patterns, members of literals under names, texts, numbers, symbols with and without
//               descriptions and computed keys, fields of classes, static fields, private fields, elements of lists, arguments, what a function returns, behind parentheses, behind a condition
//   parameters  none, several, defaults in every place, a rest, patterns
//   own names   a class with a static member `name`, as a field, a method and a getter; a function whose `name` is redefined, deleted, stored to
//   read        `name` and `length` with their attributes, the own keys in their order, whether there is a `prototype` and what it holds, the prototype of the function
import type { Random } from "./random";

const head = `const lines = [];
function note(...parts) {
  lines.push(parts.join(" "));
}
const kindsOfFunctions = new Map([
  [Function.prototype, "Function"],
  [Object.getPrototypeOf(async function () {}), "AsyncFunction"],
  [Object.getPrototypeOf(function* () {}), "GeneratorFunction"],
  [Object.getPrototypeOf(async function* () {}), "AsyncGeneratorFunction"],
]);
function about(value) {
  if (typeof value !== "function") return "no function: " + String(value);
  const flags = key => {
    const found = Object.getOwnPropertyDescriptor(value, key);
    if (!found) return "none";
    return ("value" in found ? JSON.stringify(typeof found.value === "function" ? "a function" : found.value) : "accessor") + (found.writable ? "w" : "") + (found.enumerable ? "e" : "") + (found.configurable ? "c" : "");
  };
  const above = Object.getPrototypeOf(value);
  let name;
  try {
    name = JSON.stringify(typeof value.name === "function" ? "a function" : value.name);
  } catch (error) {
    name = "THROWS";
  }
  return [
    "name " + name + " " + flags("name"),
    "length " + flags("length"),
    "keys " + Reflect.ownKeys(value).map(String).join(),
    "prototype " + (Object.hasOwn(value, "prototype") ? flags("prototype").replace(/^\\{.*\\}|^"[^"]*"/, "") + " holds " + Reflect.ownKeys(value.prototype).map(String).join() : "none"),
    "below " + (kindsOfFunctions.get(above) ?? (typeof above === "function" ? "function " + above.name : String(above))),
  ].join(" | ");
}
function attempt(label, run) {
  try {
    note(label + ":", about(run()));
  } catch (error) {
    note(label + ":", "THROWS", error.constructor.name);
  }
}
function keep() {}
// Plain Bun settles an operator whose left side is a constant, and the function behind it gets a name: so these are variables.
let nothing = null,
  zero = 0,
  one = 1;
const mark = Symbol("mark");
const bare = Symbol();
class Above {}
`;

export function generate(random: Random): string {
  let count = 0;
  const parameters = () =>
    random.pick([
      "",
      "",
      "a",
      "a, b",
      "a, b, c",
      "a = 1",
      "a, b = 1",
      "a = 1, b",
      "a, b = 1, c",
      "...rest",
      "a, ...rest",
      "{ a }",
      "[a], b",
      "{ a } = {}",
      "a, { b }, c = 1, d",
    ]);
  /** A function or a class that has no name of its own. */
  const unnamed = () =>
    random.pick<() => string>([
      () => `function (${parameters()}) {}`,
      () => `(${parameters()}) => {}`,
      () => `async function (${parameters()}) {}`,
      () => `async (${parameters()}) => {}`,
      () => `function* (${parameters()}) {}`,
      () => `async function* (${parameters()}) {}`,
      () => `class {}`,
      () => `class {\nconstructor(${parameters()}) {}\n}`,
      () => `class extends Above {}`,
      () => `class {\nstatic name = "an own name";\n}`,
      () => `class {\nstatic name() {}\n}`,
      () => `class {\nstatic get name() {\nreturn "from a getter";\n}\n}`,
      () => `class {\nstatic other = 1;\nstatic m() {}\n}`,
      () => `class {\nstatic #hidden = 1;\n}`,
    ])();
  const named = () =>
    random.pick([
      `function own${count++}(${parameters()}) {}`,
      `class Own${count++} {}`,
      `async function own${count++}() {}`,
      `function* own${count++}() {}`,
    ]);
  const value = () => (random.chance(0.85) ? unnamed() : named());
  const key = () =>
    random.pick([
      "plain",
      '"a text"',
      "1",
      "1.5",
      "[mark]",
      "[bare]",
      '["com" + "puted"]',
      "[1 + 1]",
      "[Symbol.iterator]",
      "[`t${1}`]",
      "get",
      "async",
      "[null]",
      '[Symbol.for("shared")]',
      '"__proto__x"',
    ]);
  const read = (name: string) =>
    name.startsWith("[") ? `held${name}` : /^["\d]/.test(name) ? `held[${name}]` : `held.${name}`;

  const kinds: (() => string)[] = [
    () => `attempt("const", () => {\nconst given = ${value()};\nreturn given;\n});`,
    () => `attempt("let", () => {\nlet given = ${value()};\nreturn given;\n});`,
    () => `attempt("var", () => {\nvar given = ${value()};\nreturn given;\n});`,
    () => `attempt("an assignment", () => {\nlet given;\ngiven = ${value()};\nreturn given;\n});`,
    () =>
      `attempt("a logical assignment", () => {\nlet given${random.pick([" = 0;\ngiven ||=", " = 1;\ngiven &&=", ";\ngiven ??="])} ${value()};\nreturn given;\n});`,
    () => `attempt("parentheses", () => {\nconst given = (${value()});\nreturn given;\n});`,
    () => `attempt("a condition", () => {\nconst given = lines ? ${value()} : 0;\nreturn given;\n});`,
    () =>
      `attempt("either side", () => {\nconst given = ${random.pick(["nothing ??", "zero ||", "one &&"])} (${value()});\nreturn given;\n});`,
    () => `attempt("a default of a parameter", () => ((given = ${value()}) => given)());`,
    () => `attempt("a default in a pattern", () => {\nconst { given = ${value()} } = {};\nreturn given;\n});`,
    () => `attempt("a default in a list pattern", () => {\nconst [given = ${value()}] = [];\nreturn given;\n});`,
    () =>
      `attempt("a default under another name", () => {\nconst { other: given = ${value()} } = {};\nreturn given;\n});`,
    () =>
      `attempt("a default of an assigned pattern", () => {\nlet given;\n({ given = ${value()} } = {});\nreturn given;\n});`,
    (name = key()) =>
      `attempt(${JSON.stringify("a member " + name)}, () => {\nconst held = { ${name}: ${value()} };\nreturn ${read(name)};\n});`,
    (name = key()) =>
      `attempt(${JSON.stringify("a method " + name)}, () => {\nconst held = { ${random.pick(["", "async ", "*", "async *"])}${name}(${parameters()}) {} };\nreturn ${read(name)};\n});`,
    (name = key()) =>
      `attempt(${JSON.stringify("a getter " + name)}, () => {\nconst held = { get ${name}() {\nreturn 1;\n}, set ${name}(given) {} };\nreturn Object.getOwnPropertyDescriptor(held, Reflect.ownKeys(held)[0]).${random.pick(["get", "set"])};\n});`,
    (name = key()) =>
      `attempt(${JSON.stringify("a field " + name)}, () => {\nconst held = new (class {\n${name} = ${value()};\n})();\nreturn ${read(name)};\n});`,
    (name = key()) =>
      `attempt(${JSON.stringify("a static field " + name)}, () => {\nconst held = class {\nstatic ${name} = ${value()};\n};\nreturn ${read(name)};\n});`,
    (name = key()) =>
      `attempt(${JSON.stringify("a method of a class " + name)}, () => {\nconst held = class {\nstatic ${random.pick(["", "async ", "*"])}${name}(${parameters()}) {}\n};\nreturn ${read(name)};\n});`,
    () =>
      `attempt("a private field", () =>\nnew (class {\n#hidden = ${value()};\nread() {\nreturn this.#hidden;\n}\n})().read(),\n);`,
    () =>
      `attempt("a private method", () =>\nnew (class {\n${random.pick(["", "async ", "*"])}#hidden(${parameters()}) {}\nread() {\nreturn this.#hidden;\n}\n})().read(),\n);`,
    () => `attempt("a store to a member", () => {\nconst held = {};\nheld.given = ${value()};\nreturn held.given;\n});`,
    () => `attempt("an element", () => [${value()}][0]);`,
    () => `attempt("an argument", () => (given => given)(${value()}));`,
    () => `attempt("returned", () => (() => {\nreturn ${value()};\n})());`,
    () =>
      `attempt("a declaration", () => {\n${random.pick([`function declared(${parameters()}) {}`, `async function declared(${parameters()}) {}`, `function* declared(${parameters()}) {}`, `class declared {\nconstructor(${parameters()}) {}\n}`, "class declared extends Above {}", "class declared extends null {}"])}\nreturn declared;\n});`,
    () =>
      `attempt("bound", () => {\nconst given = ${value().startsWith("class") ? "function (a, b, c) {}" : `function (${parameters()}) {}`};\nreturn given.bind(${random.pick(["null", "null, 1", "null, 1, 2, 3, 4"])})${random.pick(["", ".bind(null)", ".bind(null, 1)"])};\n});`,
    () => `attempt("a proxy", () => {\nconst given = ${value()};\nreturn new Proxy(given, {});\n});`,
    () =>
      `attempt("made from text", () => new Function(${random.pick(['""', '"a", "b", ""', '"a = 1", ""', '"...rest", ""'])}));`,
    () =>
      `attempt("a built-in", () => ${random.pick(["Math.max", "Array.prototype.map", "Object", "Promise", "parseInt", "Array.prototype[Symbol.iterator]", 'Object.getOwnPropertyDescriptor(Map.prototype, "size").get', "Function.prototype", "Symbol.prototype[Symbol.toPrimitive]", "JSON.stringify", "Proxy", "Reflect.get", "(function () {}).bind"])});`,
    () =>
      `attempt("a name redefined", () => {\nconst given = ${unnamed()};\nObject.defineProperty(given, "name", { value: ${random.pick(['"redefined"', "1", "mark", "undefined"])} });\nreturn given;\n});`,
    () =>
      `attempt("a name deleted", () => {\nconst given = ${unnamed()};\ndelete given.name;\n${random.pick(["", "delete given.length;", 'given.name = "stored";'])}\nreturn given;\n});`,
    () =>
      `attempt("a name stored to", () => {\nconst given = ${unnamed()};\ntry {\ngiven.name = "stored";\ngiven.length = 9;\n} catch (error) {\nnote("refused", error.constructor.name);\n}\nreturn given;\n});`,
    () =>
      `attempt("made twice", () => {\nconst make = () => ${unnamed().startsWith("class") ? "class {}" : "function () {}"};\nconst first = make();\nObject.defineProperty(first, "name", { value: "the first" });\nreturn make();\n});`,
  ];
  const rows = Array.from({ length: random.between(14, 30) }, () => random.pick(kinds)());
  // Plain Bun puts a `let` or `const` that is read once, in the next statement, where it is read, and the function gets no name: so a call stands between.
  const text = rows.join("\n").replace(/;\n(return given|return new Proxy\(given)/g, ";\nkeep();\n$1");
  return `${head}${text}\nconsole.log(lines.join("\\n"));\n`;
}
