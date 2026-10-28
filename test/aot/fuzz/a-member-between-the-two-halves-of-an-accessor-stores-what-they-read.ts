// Small programs in which the getter and the setter of one name stand apart in a literal or a class, and a member between them stores to a variable that the halves read. The members of a
// literal run in the order in which they are written, so what the halves find is what the last store left, whichever half was written first.
//
//   the variable     a `let`, a `var` or a parameter of the function round the literal; a `let` at the top of the file
//   a half reads it  by its name, in an arrow called on the spot, through a function declared below, as the default of the setter's parameter, in a text
//   the store        `q: (c = v)`, `c++`, a pattern, `||=`, `??=`, `+=`, an argument, a computed key, `__proto__`, a spread, behind an `await` or a `yield`; in a function declared below, an arrow
//                    called on the spot, `eval`, `arguments`
//   behind it        nothing, one more store, a closure that stores, a second literal
//   who holds them   an object literal, a literal in a list, an argument, what an arrow returns, a class with static members, a class with members of its instances
import type { Random } from "./random";

export function generate(random: Random): { file: string; text: string } {
  const sloppy = random.chance(0.3);
  const kind = random.pick(["plain", "plain", "plain", "async", "generator"]);
  const holder = random.pick([
    "literal",
    "literal",
    "literal",
    "literal",
    "in a list",
    "argument",
    "static",
    "instance",
  ]);
  const isClass = holder === "static" || holder === "instance";
  const variable = random.pick(["let", "let", "var", "parameter", "top"]);
  const values = random.shuffled([
    "v",
    "v + 1",
    "v * 2",
    "String(v)",
    "[v]",
    "{ v }",
    "v + 0.5",
    "-v",
    "null",
    "undefined",
  ]);
  let next = 0;
  const value = () => values[next++ % values.length];
  const reads = () =>
    random.pick([
      "c",
      "c",
      "c",
      "(() => c)()",
      "read()",
      "`${show(c)}`",
      "[c][0]",
      "{ c }.c",
      sloppy ? 'eval("c")' : "(0, () => c)()",
    ]);
  const getter = (prefix: string) => `${prefix}get p() {\nreturn ${reads()};\n}`;
  const setter = (prefix: string) =>
    random.pick([
      `${prefix}set p(x) {}`,
      `${prefix}set p(x) {\nseen.push(show(x), show(${reads()}));\n}`,
      `${prefix}set p(x = c) {\nseen.push(show(x));\n}`,
      `${prefix}set p(x) {\nc = x;\n}`,
    ]);
  const inExpression = () =>
    random.pick([
      () => `(c = ${value()})`,
      () => `(c = ${value()})`,
      () => `(c = ${value()})`,
      () => "c++",
      () => "++c",
      () => `([c] = [${value()}])`,
      () => `({ c } = { c: ${value()} })`,
      () => `(c ||= ${value()})`,
      () => `(c ??= ${value()})`,
      () => `(c &&= ${value()})`,
      () => `(c += ${value()})`,
      () => `id((c = ${value()}))`,
      () => `store(${value()})`,
      () => `(() => (c = ${value()}))()`,
      () => `[(c = ${value()})]`,
      () => `{ inner: (c = ${value()}) }`,
      () => `(hidden ? 0 : (c = ${value()}))`,
      () => `(hidden || (c = ${value()}))`,
      () =>
        sloppy ? `eval("c = " + JSON.stringify(${random.pick(["v", "v + 1", "String(v)"])}))` : `store(${value()})`,
      () =>
        sloppy && variable === "parameter" && kind === "plain" ? `(arguments[1] = ${value()})` : `(c = ${value()})`,
      () =>
        kind === "async"
          ? `(c = await ${value()})`
          : kind === "generator"
            ? `(c = yield ${value()})`
            : `(c = ${value()})`,
      () =>
        kind === "async"
          ? `(c = await ${value()})`
          : kind === "generator"
            ? `(c = yield ${value()})`
            : `store(${value()})`,
    ])();
  let names = 0;
  let hasPrototype = false;
  const between = (prefix: string) => {
    const name = `q${names++}`;
    if (isClass)
      return random.pick([
        `${prefix}[(${inExpression()}, "${name}")] = 1;`,
        `${prefix}[(${inExpression()}, "${name}")]() {}`,
        holder === "static" && kind === "plain"
          ? `static ${name} = ${inExpression()};`
          : `${prefix}[(${inExpression()}, "${name}")] = 2;`,
        holder === "static" && kind === "plain"
          ? `static {\n${inExpression()};\n}`
          : `${prefix}[(${inExpression()}, "${name}")]() {}`,
      ]);
    const member = random.below(8);
    if (member === 5 && !hasPrototype) {
      hasPrototype = true;
      return `__proto__: (${inExpression()}, null)`;
    }
    return [
      `${name}: ${inExpression()}`,
      `${name}: ${inExpression()}`,
      `${name}: ${inExpression()}`,
      `[(${inExpression()}, "${name}")]: 1`,
      `[(${inExpression()}, "${name}")]() {}`,
      `${name}: ${inExpression()}`,
      `...(${inExpression()}, { ${name}: 1 })`,
      `${name}: 0`,
    ][member];
  };
  const prefix = holder === "static" ? "static " : "";
  const halves = random.chance(0.5) ? [setter(prefix), getter(prefix)] : [getter(prefix), setter(prefix)];
  const members = [
    ...(random.chance(0.3) ? [between(prefix)] : []),
    halves[0],
    ...Array.from({ length: random.pick([1, 1, 1, 2, 3]) }, () => between(prefix)),
    halves[1],
    ...(random.chance(0.3) ? [between(prefix)] : []),
  ];
  const body = isClass ? `class {\n${members.join("\n")}\n}` : `{\n${members.join(",\n")},\n}`;
  const made = {
    literal: `const o = ${body};`,
    "in a list": `const [o] = [${body}];`,
    argument: `const o = id(${body});`,
    static: `const o = ${body};`,
    instance: `const o = new (${body})();`,
  }[holder]!;
  const behind = random.pick([
    "",
    "",
    "c += 100;",
    `later.push(() => (c = ${value()}));`,
    `c = ${value()};`,
    `const second = { get p() {\nreturn c;\n}, r: (c = ${value()}) };\nseen.push(show(second.p));`,
  ]);
  // A function that stores to the variable changes how it is held, so it stands in the text only where something calls it.
  const uses = (call: string) => (made + behind).includes(call);
  const declared = { let: "let c = 0;", var: "var c = 0;", parameter: "", top: "" }[variable]!;
  const star = kind === "generator" ? "*" : "";
  const text = [
    sloppy ? "" : '"use strict";',
    'const show = x => (typeof x === "function" ? "function" : typeof x === "object" && x !== null ? JSON.stringify(x) : typeof x === "string" ? `"${x}"` : Object.is(x, -0) ? "-0" : String(x));',
    "const id = x => x;",
    "const hidden = process.argv.length > 99;",
    "const seen = [];",
    "const later = [];",
    variable === "top" ? "let c = 0;" : "",
    `${kind === "async" ? "async " : ""}function${star} make(v${variable === "parameter" ? ", c" : ""}) {`,
    declared,
    made,
    behind,
    "return o;",
    uses("read(") ? "function read() {\nreturn c;\n}" : "",
    uses("store(") ? "function store(x) {\nc = x;\nreturn x;\n}" : "",
    "}",
    kind === "generator"
      ? "function run(v, c) {\nconst steps = make(v, c);\nlet step = steps.next();\nwhile (!step.done) step = steps.next(step.value);\nreturn step.value;\n}"
      : "",
    `${kind === "async" ? "async " : ""}function look(v, c) {`,
    `const o = ${kind === "async" ? "await make(v, c)" : kind === "generator" ? "run(v, c)" : "make(v, c)"};`,
    "console.log(show(o.p));",
    "for (const each of later.splice(0)) each();",
    "console.log(show(o.p));",
    "o.p = 7;",
    "console.log(show(o.p), seen.splice(0).join());",
    'console.log(Reflect.ownKeys(o).filter(name => typeof name === "string" && !["length", "name", "prototype"].includes(name)).map(name => name + ":" + show(o[name])).join());',
    'const found = Object.getOwnPropertyDescriptor(o, "p") ?? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(o), "p");',
    "console.log(typeof found.get, typeof found.set, found.enumerable);",
    "}",
    ...random
      .shuffled(["5", "hidden ? 1 : 5", "0", "1.5", "-1", 'Number("3")'])
      .slice(0, random.pick([1, 2, 3]))
      .map(v => `${kind === "async" ? "await " : ""}look(${v}, ${random.pick(["0", "1", "undefined", '"c"'])});`),
  ]
    .filter(Boolean)
    .join("\n");
  return {
    file: kind === "async" ? "main.mjs" : sloppy ? "main.cjs" : random.pick(["main.mjs", "main.cjs"]),
    text: text + "\n",
  };
}
