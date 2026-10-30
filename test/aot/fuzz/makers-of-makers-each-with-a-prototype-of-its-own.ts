// One function makes a prototype object and returns a maker of objects below it. The program calls it several times, so one place in the text makes objects below several prototypes.
//
//   the function   an arrow, a declaration, a method; the prototype is a literal, the answer of another function, an object below a shared base, the `prototype` of a constructor or of a class that it declares;
//                  it counts its calls in a variable outside, in a member of itself, in a variable that only its own maker sees
//   called         at the top level one to forty times; there in a block, a loop, a try, a conditional; in a function; through call, apply, bind, map, another name; by itself
//   the objects    made by every maker, some in a hot loop; read by name, by a computed name, through methods, by for-in, keys, JSON
//   then changed   a member added to one prototype, replaced, deleted, turned into a getter; a prototype frozen; an object moved below another maker's prototype or below null; a field that hides a method
//   asked          which prototypes, makers, methods are the same; names, lengths and texts of the functions; isPrototypeOf, instanceof, constructor
import type { Random } from "./random";

const prelude = `let calls = 0;
function show(value) {
  if (typeof value === "function") return "function " + value.name + "/" + value.length;
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return Object.is(value, -0) ? "-0" : String(value);
}
function attempt(act) {
  try {
    return show(act());
  } catch (error) {
    return error.constructor.name;
  }
}
function look(label, one) {
  const all = [];
  for (const key in one) all.push(key);
  const below = Object.getPrototypeOf(one);
  console.log(label, Object.keys(one).join(), "|", all.join(), "|", below ? Object.getOwnPropertyNames(below).join() : "null", "|", attempt(() => one.get()), attempt(() => one.bump().value), attempt(() => one.kind), attempt(() => one["get"]()), attempt(() => one.extra()), show(one));
}
function membersOf(options) {
  return {
    get() {
      return this.value + options.add;
    },
    bump() {
      this.value += 1;
      return this;
    },
    kind: options.kind,
  };
}
const base = {
  bump() {
    this.value += 10;
    return this;
  },
  kind: "base",
};`;

const literal = `{
    get() {
      return this.value + options.add;
    },
    bump() {
      this.value += 1;
      return this;
    },
    kind: options.kind,
  }`;

/** The text of a function `name(options)` whose answer makes objects: `make(value)`, or `new make(value)` where `builds`. */
type Kind = { builds?: boolean; write: (name: string, count: string) => string };
const kinds: Kind[] = [
  {
    write: (name, count) =>
      `const ${name} = options => {\n  ${count}\n  const members = ${literal};\n  return value => {\n    const self = Object.create(members);\n    self.value = value;\n    return self;\n  };\n};`,
  },
  {
    write: (name, count) =>
      `function ${name}(options) {\n  ${count}\n  const members = ${literal};\n  return function make(value) {\n    const self = Object.create(members);\n    self.value = value;\n    return self;\n  };\n}`,
  },
  {
    write: (name, count) =>
      `function ${name}(options) {\n  ${count}\n  const members = membersOf(options);\n  return value => {\n    const self = Object.create(members);\n    self.value = value;\n    return self;\n  };\n}`,
  },
  {
    write: (name, count) =>
      `const ${name} = options => {\n  ${count}\n  const members = Object.create(base);\n  members.get = function () {\n    return this.value + options.add;\n  };\n  return value => {\n    const self = Object.create(members);\n    self.value = value;\n    return self;\n  };\n};`,
  },
  {
    write: (name, count) =>
      `const ${name} = options => {\n  ${count}\n  const members = ${literal};\n  return value => Object.create(members, { value: { value, writable: true, enumerable: true, configurable: true } });\n};`,
  },
  {
    write: (name, count) =>
      `const ${name} = options => {\n  ${count}\n  const members = ${literal};\n  return value => Object.assign(Object.create(members), { value, twice: value * 2 });\n};`,
  },
  {
    write: (name, count) =>
      `const ${name} = options => {\n  ${count}\n  const members = ${literal};\n  return value => ({ __proto__: members, value });\n};`,
  },
  {
    write: (name, count) =>
      `const ${name} = options => {\n  ${count}\n  const members = ${literal};\n  return value => Object.setPrototypeOf({ value }, members);\n};`,
  },
  {
    write: (name, count) =>
      `const ${name} = options => {\n  ${count}\n  const members = ${literal};\n  const others = { get: () => "other", bump: members.bump, kind: "other" };\n  return value => {\n    const self = Object.create(value % 5 === 4 ? others : members);\n    self.value = value;\n    return self;\n  };\n};`,
  },
  {
    write: (name, count) =>
      `const ${name} = options => {\n  ${count}\n  let made = 0;\n  const members = ${literal};\n  members.made = () => made;\n  return value => {\n    made++;\n    const self = Object.create(members);\n    self.value = value + made;\n    return self;\n  };\n};`,
  },
  {
    builds: true,
    write: (name, count) =>
      `function ${name}(options) {\n  ${count}\n  function Thing(value) {\n    this.value = value;\n  }\n  Thing.prototype = ${literal};\n  return Thing;\n}`,
  },
  {
    builds: true,
    write: (name, count) =>
      `function ${name}(options) {\n  ${count}\n  function Thing(value) {\n    this.value = value;\n  }\n  Thing.prototype.get = function () {\n    return this.value + options.add;\n  };\n  Thing.prototype.bump = function () {\n    this.value += 1;\n    return this;\n  };\n  Thing.prototype.kind = options.kind;\n  return Thing;\n}`,
  },
  {
    builds: true,
    write: (name, count) =>
      `const ${name} = options =>\n  class Thing {\n    static kind = (${count.replace(/;$/, "")}, options.kind);\n    constructor(value) {\n      this.value = value;\n    }\n    get() {\n      return this.value + options.add;\n    }\n    bump() {\n      this.value += 1;\n      return this;\n    }\n    get kind() {\n      return options.kind;\n    }\n  };`,
  },
];

function family(random: Random, index: number): string {
  const name = `family${index}`;
  const kind = random.pick(kinds);
  const count = random.pick(["calls++;", `${name}.calls = (${name}.calls ?? 0) + 1;`, "calls += 2;"]);
  const lines: string[] = [kind.write(name, count)];
  const makers: string[] = [];
  const options = () => `{ add: ${random.pick(["1", "2", "0.5", "10", `"!"`, "-0"])}, kind: "k${makers.length}" }`;
  const many = random.weighted([[5, random.between(1, 4)], [1, random.between(8, 14)], [1, 40]]); // prettier-ignore
  for (let k = 0; k < many; k++) {
    const maker = `make${index}_${k}`;
    makers.push(maker);
    const call = random.weighted([
      [10, `${name}(${options()})`],
      [1, `${name}.call(null, ${options()})`],
      [1, `${name}.apply(null, [${options()}])`],
      [1, `${name}.bind(null)(${options()})`],
      [1, `[${options()}].map(${name})[0]`],
      [1, `(0, ${name})(${options()})`],
      [1, `[${name}][0](${options()})`],
      [1, `(() => ${name}(${options()}))()`],
    ] as const); // prettier-ignore
    lines.push(
      many > 6
        ? `const ${maker} = ${name}(${options()});`
        : random.weighted([
            [8, `const ${maker} = ${call};`],
            [1, `let ${maker};\n{\n  ${maker} = ${call};\n}`],
            [1, `let ${maker};\nfor (let turn = 0; turn < 2; turn++) ${maker} = ${call};`],
            [1, `let ${maker};\ntry {\n  ${maker} = ${call};\n} finally {\n  calls++;\n}`],
            [1, `const ${maker} = calls >= 0 ? ${call} : null;`],
            [1, `function set${index}_${k}() {\n  return ${call};\n}\nconst ${maker} = set${index}_${k}();`],
          ] as const),
    );
  }
  const build = (maker: string, value: string) => (kind.builds ? `new ${maker}(${value})` : `${maker}(${value})`);
  const first = makers[0];
  const last = makers[makers.length - 1];
  const any = () => random.pick(makers);
  lines.push(`const all${index} = [${makers.map((maker, k) => build(maker, String(k + 1))).join(", ")}];`);
  lines.push(`all${index}.slice(0, 5).forEach((one, at) => look("${index} made " + at, one));`);
  const acts = [
    () =>
      `console.log("${index} same", Object.getPrototypeOf(${build(first, "1")}) === Object.getPrototypeOf(${build(first, "2")}), Object.getPrototypeOf(${build(first, "1")}) === Object.getPrototypeOf(${build(last, "1")}), ${first} === ${last}, ${build(first, "1")}.get === ${build(first, "2")}.get, ${build(first, "1")}.get === ${build(last, "2")}.get, new Set(all${index}.map(Object.getPrototypeOf)).size);`,
    () =>
      `console.log("${index} texts", show(${name}), show(${first}), String(${first}) === String(${last}), show(${build(any(), "1")}.get));`,
    () =>
      `{\n  let sum = 0;\n  for (let turn = 0; turn < 3000; turn++) sum += all${index}[turn % all${index}.length].get().length ?? all${index}[turn % all${index}.length].get();\n  console.log("${index} sum", sum);\n}`,
    () =>
      `{\n  let sum = 0;\n  for (let turn = 0; turn < 2000; turn++) sum += ${build(any(), "turn")}.bump().value;\n  console.log("${index} fresh", sum);\n}`,
    () =>
      `Object.getPrototypeOf(all${index}[0]).extra = function () {\n  return "extra " + this.value;\n};\nlook("${index} added", all${index}[0]);\nlook("${index} added beside", all${index}[all${index}.length - 1]);\nlook("${index} added later", ${build(first, "7")});`,
    () =>
      `Object.getPrototypeOf(${build(any(), "0")}).get = function () {\n  return "replaced " + this.value;\n};\nall${index}.slice(0, 4).forEach((one, at) => look("${index} replaced " + at, one));`,
    () =>
      `delete Object.getPrototypeOf(${build(any(), "0")}).bump;\nall${index}.slice(0, 4).forEach((one, at) => look("${index} deleted " + at, one));`,
    () =>
      `Object.defineProperty(Object.getPrototypeOf(${build(any(), "0")}), "kind", { get() { return "got " + this.value; }, configurable: true });\nall${index}.slice(0, 4).forEach((one, at) => look("${index} getter " + at, one));`,
    () =>
      `Object.freeze(Object.getPrototypeOf(${build(any(), "0")}));\nconsole.log("${index} frozen", attempt(() => { "use strict"; const one = ${build(first, "3")}; one.kind = "own"; return one.kind; }), attempt(() => { const one = ${build(last, "3")}; one.kind = "own"; return one.kind; }));`,
    () =>
      `Object.setPrototypeOf(all${index}[0], Object.getPrototypeOf(all${index}[all${index}.length - 1]));\nlook("${index} moved", all${index}[0]);\nlook("${index} stayed", ${build(first, "5")});`,
    () =>
      `Object.setPrototypeOf(all${index}[0], null);\nconsole.log("${index} below null", Object.keys(all${index}[0]).join(), attempt(() => all${index}[0].get()), all${index}[0].value);\nall${index}[0] = ${build(first, "9")};`,
    () =>
      `all${index}[0].get = () => "own";\nlook("${index} hidden", all${index}[0]);\ndelete all${index}[0].get;\nlook("${index} shown", all${index}[0]);`,
    () =>
      `console.log("${index} below", Object.getPrototypeOf(all${index}[0]).isPrototypeOf(${build(first, "1")}), Object.getPrototypeOf(all${index}[0]).isPrototypeOf(${build(last, "1")}), attempt(() => ${build(first, "1")} instanceof ${first}), attempt(() => ${build(first, "1")} instanceof ${last}), show(${build(any(), "1")}.constructor));`,
    () => `console.log("${index} calls", calls, ${name}.calls);`,
    () =>
      `console.log("${index} copies", show({ ...all${index}[0] }), show(Object.assign(Object.create(Object.getPrototypeOf(all${index}[0])), all${index}[0]).get()), attempt(() => all${index}[0].made()));`,
    () =>
      `function late${index}() {\n  const maker = ${name}({ add: 100, kind: "late" });\n  return ${build("maker", "1")};\n}\nlook("${index} late", late${index}());\nlook("${index} late again", late${index}());\nconsole.log("${index} late same", Object.getPrototypeOf(late${index}()) === Object.getPrototypeOf(late${index}()));`,
  ];
  for (const act of random.shuffled(acts).slice(0, random.between(3, 8)))
    lines.push(`try {\n${act()}\n} catch (error) {\n  console.log("${index} threw", error.constructor.name);\n}`);
  return lines.join("\n");
}

function mixed(random: Random, families: number): string {
  if (families < 2) return "";
  const lists = Array.from({ length: families }, (_, index) => `...all${index}`).join(", ");
  return `{\n  const everything = [${lists}];\n  let text = "";\n  for (let turn = 0; turn < 4000; turn++) {\n    const one = everything[turn % everything.length];\n    if (turn % 997 === 0) text += attempt(() => one.get()) + attempt(() => one.kind) + ";";\n    else attempt(() => one.get());\n  }\n  console.log("mixed", text, new Set(everything.map(Object.getPrototypeOf)).size);\n}`;
}

export function generate(random: Random): string {
  const families = random.between(1, 3);
  return (
    [prelude, ...Array.from({ length: families }, (_, index) => family(random, index)), mixed(random, families)]
      .filter(part => part !== "")
      .join("\n") + "\n"
  );
}
