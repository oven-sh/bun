// An object is made, then something that its making read is written, and only then is the object used: `const q = new Q(a); Q.prototype = second; q.b = 1;`. The object is what it was made as.
// What the making reads x what writes it x where that write runs x the first use of the object x what is asked of it x whether an object of that kind was made before:
// each once, twenty to a program, each in a block with a constructor of its own, so that every write is the first of its kind in the run.

type Named = { name: string; text: string };

const twoPrototypes = `first.describe = function () { return "first"; };
  const second = { describe() { return "second"; }, other: "second" };`;
const ofAPrototype: readonly Named[] = [
  { name: "a call through the prototype", text: "q.describe()" },
  { name: "its prototype", text: "Object.getPrototypeOf(q) === first" },
  { name: "isPrototypeOf", text: "first.isPrototypeOf(q)" },
  { name: "a member of the other prototype", text: "String(q.other)" },
  { name: "its keys", text: "Object.keys(q).join()" },
  { name: "JSON", text: "JSON.stringify(q)" },
  { name: "it leaves", text: "(kept.push(q), kept[kept.length - 1].describe())" },
];
const ofAField: readonly Named[] = [
  { name: "the field", text: "q.a" },
  { name: "its keys", text: "Object.keys(q).join()" },
  { name: "JSON", text: "JSON.stringify(q)" },
  { name: "it leaves", text: "(kept.push(q), kept[kept.length - 1].a)" },
];
const toThePrototypeOf = (holder: string): readonly Named[] => [
  { name: "a store", text: `${holder}.prototype = second;` },
  { name: "a store under a computed key", text: `${holder}[nameOfPrototype] = second;` },
  { name: "Object.defineProperty", text: `Object.defineProperty(${holder}, "prototype", { value: second });` },
  { name: "Reflect.defineProperty", text: `Reflect.defineProperty(${holder}, "prototype", { value: second });` },
  { name: "Reflect.set", text: `Reflect.set(${holder}, "prototype", second);` },
  { name: "Object.assign", text: `Object.assign(${holder}, { prototype: second });` },
];

/** `declares` stands in the block. `makes` makes the object; `a` is a parameter there. `writes` change what `makes` read. `asks` look at the object `q`. */
const made: readonly { name: string; declares: string; makes: string; writes: readonly Named[]; asks: readonly Named[] }[] = [
  {
    name: "the prototype of a constructor function",
    declares: `function Q(a) { this.a = a; }\n  const first = Q.prototype;\n  ${twoPrototypes}`,
    makes: "new Q(a)",
    writes: [
      ...toThePrototypeOf("Q"),
      { name: "the prototype of the prototype", text: "Object.setPrototypeOf(Q.prototype, second);" },
      { name: "a setter for the field that is stored next", text: 'Object.defineProperty(Q.prototype, "b", { set(v) { seen.push("set " + v); }, configurable: true });' },
    ],
    asks: [...ofAPrototype, { name: "instanceof", text: "q instanceof Q" }, { name: "the field", text: "q.a" }],
  },
  {
    name: "the prototype of a constructor function under another name",
    declares: `function Q(a) { this.a = a; }\n  const Same = Q;\n  const first = Q.prototype;\n  ${twoPrototypes}`,
    makes: "new Same(a)",
    writes: toThePrototypeOf("Q"),
    asks: ofAPrototype,
  },
  {
    name: "the prototype of a bound constructor function",
    declares: `function Q(a) { this.a = a; }\n  const Bound = Q.bind(null);\n  const first = Q.prototype;\n  ${twoPrototypes}`,
    makes: "new Bound(a)",
    writes: toThePrototypeOf("Q"),
    asks: ofAPrototype,
  },
  {
    name: "the prototype of new.target",
    declares: `function Q(a) { this.a = a; }\n  function T() {}\n  const first = T.prototype;\n  ${twoPrototypes}`,
    makes: "Reflect.construct(Q, [a], T)",
    writes: toThePrototypeOf("T"),
    asks: [...ofAPrototype, { name: "instanceof", text: "q instanceof T" }],
  },
  {
    name: "the class above a class",
    declares: `class Base { constructor() { this.from = "base"; } }\n  class Other { constructor() { this.from = "other"; } }\n  class Q extends Base { constructor(a) { super(); this.a = a; } }`,
    makes: "new Q(a)",
    writes: [
      { name: "Object.setPrototypeOf", text: "Object.setPrototypeOf(Q, Other);" },
      { name: "Reflect.setPrototypeOf", text: "Reflect.setPrototypeOf(Q, Other);" },
      { name: "a store to __proto__", text: "Q.__proto__ = Other;" },
    ],
    asks: [{ name: "what the class above stored", text: "q.from" }, ...ofAField],
  },
  {
    name: "the species of a list",
    declares: `class One extends Array {}\n  class Two extends Array {}\n  let kind = One;\n  class Q extends Array { static get [Symbol.species]() { return kind; } }\n  const list = Q.from([1, 2]);`,
    makes: "list.map(each => each + a)",
    writes: [{ name: "a store to the variable", text: "kind = Two;" }],
    asks: [
      { name: "the name of its constructor", text: "q.constructor.name" },
      { name: "instanceof", text: "q instanceof One" },
      { name: "its elements", text: "q.join()" },
    ],
  },
  {
    name: "a default parameter",
    declares: `let given = 1;\n  function Q(a = given) { this.a = a; }`,
    makes: "new Q()",
    writes: [{ name: "a store to the variable", text: "given = 2;" }, { name: "an increment", text: "given++;" }],
    asks: ofAField,
  },
  {
    name: "a field initializer that reads a variable",
    declares: `let given = 1;\n  class Q { a = given; }`,
    makes: "new Q()",
    writes: [{ name: "a store to the variable", text: "given = 2;" }, { name: "an increment", text: "given++;" }],
    asks: ofAField,
  },
  {
    name: "a constructor that reads a variable",
    declares: `let given = 1;\n  function Q() { this.a = given; }`,
    makes: "new Q()",
    writes: [{ name: "a store to the variable", text: "given = 2;" }, { name: "an increment", text: "given++;" }],
    asks: ofAField,
  },
  {
    name: "a constructor that reads a field of another object",
    declares: `const holder = { n: 1 };\n  function Q() { this.a = holder.n; }`,
    makes: "new Q()",
    writes: [
      { name: "a store to the field", text: "holder.n = 2;" },
      { name: "Object.assign", text: "Object.assign(holder, { n: 2 });" },
      { name: "delete", text: "delete holder.n;" },
    ],
    asks: ofAField,
  },
  {
    name: "a constructor that reads a member of new.target",
    declares: `function Q() { this.a = new.target.tag; }\n  Q.tag = 1;`,
    makes: "new Q()",
    writes: [{ name: "a store to the member", text: "Q.tag = 2;" }],
    asks: ofAField,
  },
  {
    name: "a field initializer that reads a static field",
    declares: `class Q { static start = 1; a = Q.start; }`,
    makes: "new Q()",
    writes: [{ name: "a store to the static field", text: "Q.start = 2;" }],
    asks: ofAField,
  },
  {
    name: "a constructor that counts",
    declares: `let count = 0;\n  function Q() { this.a = ++count; }`,
    makes: "new Q()",
    writes: [{ name: "a read of the count", text: 'seen.push("count " + count);' }, { name: "a store to the count", text: "count = 10;" }],
    asks: ofAField,
  },
  {
    name: "a constructor that a variable names",
    declares: `function One(a) { this.a = a; this.k = "one"; }\n  function Two(a) { this.a = a; this.k = "two"; }\n  let Q = One;`,
    makes: "new Q(a)",
    writes: [{ name: "a store to the variable", text: "Q = Two;" }],
    asks: [{ name: "what the constructor stored", text: "q.k" }, { name: "instanceof", text: "q instanceof One" }, ...ofAField],
  },
  {
    name: "a literal below a variable",
    declares: `const first = {};\n  ${twoPrototypes}\n  let chosen = first;\n  const Q = function (a) { return { __proto__: chosen, a }; };`,
    makes: "{ __proto__: chosen, a }",
    writes: [{ name: "a store to the variable", text: "chosen = second;" }],
    asks: ofAPrototype,
  },
  {
    name: "Object.create of a variable",
    declares: `const first = {};\n  ${twoPrototypes}\n  let chosen = first;\n  const Q = function () { return Object.create(chosen); };`,
    makes: "Object.create(chosen)",
    writes: [{ name: "a store to the variable", text: "chosen = second;" }],
    asks: ofAPrototype,
  },
]; // prettier-ignore

/** `W` is the write. `declares` stands in the block, `text` in the function, behind the making; it leaves a number in `x`. */
const wheres: readonly { name: string; declares?: string; text: string }[] = [
  { name: "in line", text: "W const x = 1;" },
  { name: "in a function", declares: "function change() { W return 1; }", text: "const x = change();" },
  { name: "in an arrow", declares: "const change = () => { W return 1; };", text: "const x = change();" },
  { name: "in a function that nobody can follow", declares: "function change() { W return 1; }", text: "const x = unknown(change);" },
  { name: "in a getter", declares: "const trigger = { get now() { W return 1; } };", text: "const x = trigger.now;" },
  { name: "in valueOf", declares: "const trigger = { valueOf() { W return 1; } };", text: "const x = +trigger;" },
  { name: "in toString", declares: 'const trigger = { toString() { W return "1"; } };', text: 'const x = ("" + trigger).length;' },
  { name: "in a setter", declares: "const sink = { set v(one) { W } };", text: "sink.v = 1; const x = 1;" },
  { name: "ahead of a throw that is caught", declares: 'function change() { W throw new RangeError("r"); }', text: "let x = 0; try { change(); } catch { x = 1; }" },
  { name: "in a finally", text: "let x = 0; try { x = 1; } finally { W }" },
  { name: "in a callback of a built-in", text: "let x = 0; [1].forEach(one => { W x = one; });" },
  { name: "in an arm of a conditional", text: "const x = a >= 0 ? (() => { W return 1; })() : 0;" },
]; // prettier-ignore

const uses: readonly Named[] = [
  { name: "a store", text: "q.b = x;" },
  { name: "two stores", text: "q.b = x; q.c = x + 1;" },
  { name: "a call", text: "touch(q);" },
  { name: "nothing", text: "" },
  { name: "a branch that drops it", text: 'if (x > 100) return "none";' },
  { name: "a list", text: "const all = [q, x]; touch(all.length);" },
  { name: "a closure", text: "const get = () => q; touch(get);" },
  { name: "a store through another object", text: "const box = { q }; box.q.b = x;" },
];

const heats = [undefined, "--aot-heat=everything-is-hot", "--aot-heat=everything-is-cold"] as const;

const crossed = made.flatMap(kind =>
  [true, false].flatMap(isWarm =>
    wheres.flatMap(where =>
      kind.writes.flatMap(write =>
        uses.flatMap(use => kind.asks.map(ask => ({ kind, isWarm, where, write, use, ask }))),
      ),
    ),
  ),
);

export const inOne = 20;
const inOneHeat = Math.ceil(crossed.length / inOne);
export const cases = crossed.length;
export const programs = inOneHeat * heats.length;

/** The flags that the program of that number is built with. */
export function flagsOf(index: number): string[] {
  const heat = heats[Math.floor(index / inOneHeat)];
  return heat ? [heat] : [];
}

export function programOf(index: number): { file: string; text: string } {
  // Neighbors in the table differ in the question alone: a stride that shares no factor with the length of the table takes a program from all over it.
  const stride = 7919;
  const first = (index % inOneHeat) * inOne;
  const blocks = Array.from({ length: Math.min(crossed.length, first + inOne) - first }, (_, at) => {
    const { kind, isWarm, where, write, use, ask } = crossed[((first + at) * stride) % crossed.length];
    const label = `${kind.name}, ${isWarm ? "made before" : "never made before"} | ${write.name} ${where.name} | ${use.name} | ${ask.name}`;
    return `{
  const seen = [];
  ${kind.declares}${where.declares ? `\n  ${where.declares.replace("W", write.text)}` : ""}${isWarm ? `\n  function warm(a) { const w = ${kind.makes}; return JSON.stringify(w) + Object.keys(w).length; }\n  warm(9);` : ""}
  function run(a) {
    const q = ${kind.makes};
    ${where.text.replace("W", write.text)}
    ${use.text}
    return ${ask.text};
  }
  say(${JSON.stringify(label)}, () => String(run(1)) + " " + seen.join());
}`;
  });
  return {
    file: "main.mjs",
    text: `const kept = [];
const nameOfPrototype = ["proto", "type"].join("");
const unknown = new Function("f", "return f()");
function touch(value) { return value; }
function say(label, run) {
  let line;
  try {
    line = run();
  } catch (error) {
    line = "THROWS " + error.constructor.name;
  }
  console.log(label + ": " + line);
}
${blocks.join("\n")}
`,
  };
}
