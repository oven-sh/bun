// An object is made, then something that its making read is written, and only then is the object used: `const q = new Q(a); Q.prototype = second; q.b = 1;`. The object is what it was made as.
// What the making reads x what writes it x where that write runs x the first use of the object x what is asked of it x whether an object of that kind was made before:
// each once, twenty to a program, each in a block with a constructor of its own, so that every write is the first of its kind in the run.
// Among the uses: a second object is made behind the write and the write is undone, and the whole runs three times.
// JavaScript is built at the usual heat, with everything hot and with everything cold; TypeScript as it is and with its types erased.

// In the texts below `$N`, `$S` and `$L` are the annotations `: number`, `: Shape` and `: string[]`, `$T` is the parameter `this: Shape`, `$C(x)` casts x to a constructor of shapes,
// `$R(x)` to a record and `$A(x)` to a shape. JavaScript has none of them.
const typed = (text: string) =>
  text
    .replaceAll("$N", ": number")
    .replaceAll("$S", ": Shape")
    .replaceAll("$L", ": string[]")
    .replace(/\$T(?=\))/g, "this: Shape")
    .replaceAll("$T", "this: Shape, ")
    .replace(/\$A\(((?:[^()]|\([^()]*\))*)\)/g, "($1 as unknown as Shape)")
    .replace(/\$C\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\)/g, "($1 as unknown as new (a?: number) => Shape)")
    .replace(/\$R\((\w+)\)/g, "($1 as unknown as Record<string, unknown>)");
const untyped = (text: string) =>
  text
    .replace(/\$[NSLT]/g, "")
    .replace(/\$A\(((?:[^()]|\([^()]*\))*)\)/g, "($1)")
    .replace(/\$C\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\)/g, "$1")
    .replace(/\$R\((\w+)\)/g, "$1");

type Named = { name: string; text: string };
/** `undo` is given where putting the first of each pair for the second does not undo the write. */
type Write = Named & { undo?: string };

const twoPrototypes = `first.describe = function () { return "first"; };
  const second$S = { describe() { return "second"; }, other: "second" };`;
const ofAPrototype: readonly Named[] = [
  { name: "a call through the prototype", text: "q.describe()" },
  { name: "a call through the prototype and the field", text: 'q.describe() + " " + q.a' },
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
const toThePrototypeOf = (holder: string): readonly Write[] => [
  { name: "a store", text: `${holder}.prototype = second;` },
  { name: "a store under a computed key", text: `$R(${holder})[nameOfPrototype] = second;` },
  { name: "Object.defineProperty", text: `Object.defineProperty(${holder}, "prototype", { value: second });` },
  { name: "Reflect.defineProperty", text: `Reflect.defineProperty(${holder}, "prototype", { value: second });` },
  { name: "Reflect.set", text: `Reflect.set(${holder}, "prototype", second);` },
  { name: "Object.assign", text: `Object.assign(${holder}, { prototype: second });` },
];
const toAVariable: readonly Write[] = [
  { name: "a store to the variable", text: "given = 2;" },
  { name: "an increment", text: "given++;" },
];
// Declared, so that the class has the fields of its twin in JavaScript and no more.
const fields = "declare b?: number; declare c?: number;";

/** `declares` stands in the block. `makes` makes the object; `a` is a parameter there. `writes` change what `makes` read. `asks` look at the object `q`. What `isOnlyUntyped` has no place in TypeScript. */
const made: readonly { name: string; declares: string; makes: string; writes: readonly Write[]; asks: readonly Named[]; isOnlyUntyped?: true }[] = [
  {
    name: "the prototype of a constructor function",
    declares: `function Q($Ta$N) { this.a = a; }\n  const first$S = Q.prototype;\n  ${twoPrototypes}`,
    makes: "new $C(Q)(a)",
    writes: [
      ...toThePrototypeOf("Q"),
      { name: "the prototype of the prototype", text: "Object.setPrototypeOf(Q.prototype, second);", undo: "Object.setPrototypeOf(first, Object.prototype);" },
      { name: "a setter for the field that is stored next", text: 'Object.defineProperty(Q.prototype, "b", { set(v$N) { seen.push("set " + v); }, configurable: true });', undo: "delete Q.prototype.b;" },
    ],
    asks: [...ofAPrototype, { name: "instanceof", text: "q instanceof Q" }, { name: "the field", text: "q.a" }],
  },
  {
    name: "the prototype of a constructor function that stores nothing",
    declares: `function Q($T) {}\n  const first$S = Q.prototype;\n  ${twoPrototypes}`,
    makes: "new $C(Q)()",
    writes: toThePrototypeOf("Q"),
    asks: [...ofAPrototype, { name: "instanceof", text: "q instanceof Q" }],
  },
  {
    name: "the prototype of a constructor function under another name",
    declares: `function Q($Ta$N) { this.a = a; }\n  const Same = $C(Q);\n  const first$S = Q.prototype;\n  ${twoPrototypes}`,
    makes: "new Same(a)",
    writes: toThePrototypeOf("Q"),
    asks: ofAPrototype,
  },
  {
    name: "the prototype of a bound constructor function",
    declares: `function Q($Ta$N) { this.a = a; }\n  const Bound = $C(Q.bind($A(null)));\n  const first$S = Q.prototype;\n  ${twoPrototypes}`,
    makes: "new Bound(a)",
    writes: toThePrototypeOf("Q"),
    asks: ofAPrototype,
  },
  {
    name: "the prototype of new.target",
    declares: `function Q($Ta$N) { this.a = a; }\n  function T() {}\n  const first$S = T.prototype;\n  ${twoPrototypes}`,
    makes: "$A(Reflect.construct(Q, [a], T))",
    writes: toThePrototypeOf("T"),
    asks: [...ofAPrototype, { name: "instanceof", text: "q instanceof T" }],
  },
  {
    name: "the class above a class",
    declares: `class Base { from = "base"; }\n  class Other { from = "other"; }\n  class Q extends Base { a$N; $FIELDS constructor(a$N) { super(); this.a = a; } }`,
    makes: "new Q(a)",
    writes: [
      { name: "Object.setPrototypeOf", text: "Object.setPrototypeOf(Q, Other);" },
      { name: "Reflect.setPrototypeOf", text: "Reflect.setPrototypeOf(Q, Other);" },
      { name: "a store to __proto__", text: "$R(Q).__proto__ = Other;" },
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
    isOnlyUntyped: true,
  },
  {
    name: "a default parameter",
    declares: `let given = 1;\n  function Q($Ta = given) { this.a = a; }`,
    makes: "new $C(Q)()",
    writes: toAVariable,
    asks: ofAField,
  },
  {
    name: "a field initializer that reads a variable",
    declares: `let given = 1;\n  class Q { a = given; $FIELDS }`,
    makes: "new Q()",
    writes: toAVariable,
    asks: ofAField,
  },
  {
    name: "a constructor that reads a variable",
    declares: `let given = 1;\n  function Q($T) { this.a = given; }`,
    makes: "new $C(Q)()",
    writes: toAVariable,
    asks: ofAField,
  },
  {
    name: "a constructor that reads a field of another object",
    declares: `const holder$HOLDER = { n: 1 };\n  function Q($T) { this.a = holder.n; }`,
    makes: "new $C(Q)()",
    writes: [
      { name: "a store to the field", text: "holder.n = 2;" },
      { name: "Object.assign", text: "Object.assign(holder, { n: 2 });" },
      { name: "delete", text: "delete holder.n;", undo: "holder.n = 1;" },
    ],
    asks: ofAField,
  },
  {
    name: "a constructor that reads a member of new.target",
    declares: `function Q($T) { this.a = $TAG(new.target).tag; }\n  Q.tag = 1;`,
    makes: "new $C(Q)()",
    writes: [{ name: "a store to the member", text: "Q.tag = 2;" }],
    asks: ofAField,
  },
  {
    name: "a field initializer that reads a static field",
    declares: `class Q { static start = 1; a = Q.start; $FIELDS }`,
    makes: "new Q()",
    writes: [{ name: "a store to the static field", text: "Q.start = 2;" }],
    asks: ofAField,
  },
  {
    name: "a constructor that counts",
    declares: `let count = 0;\n  function Q($T) { this.a = ++count; }`,
    makes: "new $C(Q)()",
    writes: [
      { name: "a read of the count", text: 'seen.push("count " + count);' },
      { name: "a store to the count", text: "count = 10;", undo: "count = 0;" },
    ],
    asks: ofAField,
  },
  {
    name: "a constructor that a variable names",
    declares: `function One($Ta$N) { this.a = a; this.k = "one"; }\n  function Two($Ta$N) { this.a = a; this.k = "two"; }\n  let Q = $C(One);`,
    makes: "new Q(a)",
    writes: [{ name: "a store to the variable", text: "Q = $C(Two);" }],
    asks: [{ name: "what the constructor stored", text: "q.k" }, { name: "instanceof", text: "q instanceof One" }, ...ofAField],
  },
  {
    name: "a literal below a variable",
    declares: `const first$S = $A({});\n  ${twoPrototypes}\n  let chosen = first;`,
    makes: "$A({ __proto__: chosen, a })",
    writes: [{ name: "a store to the variable", text: "chosen = second;" }],
    asks: ofAPrototype,
  },
  {
    name: "Object.create of a variable",
    declares: `const first$S = $A({});\n  ${twoPrototypes}\n  let chosen = first;`,
    makes: "$A(Object.create(chosen))",
    writes: [{ name: "a store to the variable", text: "chosen = second;" }],
    asks: ofAPrototype,
  },
]; // prettier-ignore

/** `W` is the write; where it `isHanded` what it stores, `second` is written `to` there. `declares` stands in the block, `text` in the function, behind the making; it leaves a number in `x`. */
const wheres: readonly { name: string; declares?: string; text: string; isHanded?: true }[] = [
  { name: "in line", text: "W const x = 1;" },
  { name: "in a function", declares: "function change() { W return 1; }", text: "const x = change();" },
  { name: "in a function that is handed what is stored", declares: "function change(to$S) { W return 1; }", text: "const x = change(second);", isHanded: true },
  { name: "in an arrow", declares: "const change = () => { W return 1; };", text: "const x = change();" },
  { name: "in a function that nobody can follow", declares: "function change() { W return 1; }", text: "const x$N = unknown(change);" },
  { name: "in a getter", declares: "const trigger = { get now() { W return 1; } };", text: "const x = trigger.now;" },
  { name: "in valueOf", declares: "const trigger = { valueOf() { W return 1; } };", text: "const x = +trigger;" },
  { name: "in toString", declares: 'const trigger = { toString() { W return "1"; } };', text: 'const x = ("" + trigger).length;' },
  { name: "in a setter", declares: "const sink = { set v(one$N) { W } };", text: "sink.v = 1; const x = 1;" },
  { name: "ahead of a throw that is caught", declares: 'function change() { W throw new RangeError("r"); }', text: "let x = 0; try { change(); } catch { x = 1; }" },
  { name: "in a finally", text: "let x = 0; try { x = 1; } finally { W }" },
  { name: "in a callback of a built-in", text: "let x = 0; [1].forEach(one => { W x = one; });" },
  { name: "in an arm of a conditional", text: "const x = a >= 0 ? (() => { W return 1; })() : 0;" },
]; // prettier-ignore

/** `M` is the making once more. What `makesAnother` leaves it in `r` and undoes the write by `back()`; both objects are asked. */
const uses: readonly (Named & { makesAnother?: true; runs?: number })[] = [
  { name: "a store", text: "q.b = x;" },
  { name: "two stores", text: "q.b = x; q.c = x + 1;" },
  { name: "a call", text: "touch(q);" },
  { name: "nothing", text: "" },
  { name: "a branch that drops it", text: 'if (x > 100) return "none";' },
  { name: "a list", text: "const all = [q, x]; touch(all.length);" },
  { name: "a closure", text: "const get = () => q; touch(get);" },
  { name: "a store through another object", text: "const box = { q }; box.q.b = x;" },
  { name: "a store, in three runs", text: "q.b = x;", runs: 3 },
  { name: "another is made and the write is undone", text: "q.b = x; const r = M; const y = back(); r.b = y;", makesAnother: true },
  { name: "another is made and the write is undone, in three runs", text: "q.b = x; const r = M; const y = back(); r.b = y;", makesAnother: true, runs: 3 },
]; // prettier-ignore

const undoOf = (write: Write) =>
  write.undo ??
  write.text
    .replaceAll("second", "first")
    .replaceAll("Other", "Base")
    .replaceAll("Two", "One")
    .replace("= 2;", "= 1;")
    .replace("n: 2", "n: 1")
    .replace("++", "--");

const crossedFor = (isTyped: boolean) =>
  made
    .filter(kind => !(isTyped && kind.isOnlyUntyped))
    .flatMap(kind =>
      [true, false].flatMap(isWarm =>
        wheres.flatMap(where =>
          kind.writes
            .filter(write => !where.isHanded || write.text.includes("second"))
            .flatMap(write => uses.flatMap(use => kind.asks.map(ask => ({ kind, isWarm, where, write, use, ask })))),
        ),
      ),
    );

export const inOne = 20;
const laidOut = [
  { isTyped: false, flags: [] },
  { isTyped: false, flags: ["--aot-heat=everything-is-hot"] },
  { isTyped: false, flags: ["--aot-heat=everything-is-cold"] },
  { isTyped: true, flags: [] },
  { isTyped: true, flags: ["--aot-erase-types"] },
].map(build => ({ ...build, crossed: crossedFor(build.isTyped) }));
const programsOf = (build: (typeof laidOut)[number]) => Math.ceil(build.crossed.length / inOne);
export const programs = laidOut.reduce((sum, build) => sum + programsOf(build), 0);
export const cases = laidOut.map(build => build.crossed.length);

function buildOf(index: number) {
  let first = index;
  const build = laidOut.find(build => first < programsOf(build) || ((first -= programsOf(build)), false))!;
  return { ...build, first: first * inOne };
}

/** The flags that the program of that number is built with. */
export const flagsOf = (index: number): string[] => buildOf(index).flags;

export function programOf(index: number): { file: string; text: string } {
  const { isTyped, crossed, first } = buildOf(index);
  const written = (text: string) =>
    isTyped
      ? typed(text.replaceAll("$FIELDS", fields).replaceAll("$HOLDER", ": { n?: number }").replace(/\$TAG\(([\w.]+)\)/g, "($1 as unknown as { tag: number })")) // prettier-ignore
      : untyped(
          text
            .replaceAll("$FIELDS", "")
            .replaceAll("$HOLDER", "")
            .replace(/\$TAG\(([\w.]+)\)/g, "$1"),
        );
  // Neighbors in the table differ in the question alone: a stride that shares no factor with the length of the table takes a program from all over it.
  const stride = 7919;
  const blocks = Array.from({ length: Math.min(crossed.length, first + inOne) - first }, (_, at) => {
    const { kind, isWarm, where, write, use, ask } = crossed[((first + at) * stride) % crossed.length];
    const label = `${kind.name}, ${isWarm ? "made before" : "never made before"} | ${write.name} ${where.name} | ${use.name} | ${ask.name}`;
    const stores = where.isHanded ? write.text.replaceAll("second", "to") : write.text;
    const asked = use.makesAnother
      ? `String(${ask.text}) + " " + String(${ask.text.replace(/\bq\b/g, "r")})`
      : ask.text;
    const runs = use.runs
      ? `{ let all = ""; for (let turn = 0; turn < ${use.runs}; turn++) all += String(run(turn)) + " "; return all + seen.join(); }`
      : `String(run(1)) + " " + seen.join()`;
    return written(`{
  const seen$L = [];
  ${kind.declares}${where.declares ? `\n  ${where.declares.replace("W", stores)}` : ""}${use.makesAnother ? `\n  function back() { ${undoOf(write)} return 1; }` : ""}${isWarm ? `\n  function warm(a$N) { const w = ${kind.makes}; return JSON.stringify(w) + Object.keys(w).length; }\n  warm(9);` : ""}
  function run(a$N) {
    const q = ${kind.makes};
    ${where.text.replace("W", stores)}
    ${use.text.replace("M", kind.makes)}
    return ${asked};
  }
  say(${JSON.stringify(label)}, () => ${runs});
}`);
  });
  return {
    file: isTyped ? "main.ts" : "main.mjs",
    text: `${isTyped ? "interface Shape { a?: number; b?: number; c?: number; k?: string; other?: string; describe(): string }\nconst kept: any[] = [];" : "const kept = [];"}
const nameOfPrototype = ["proto", "type"].join("");
const unknown = new Function("f", "return f()");
function touch(value${isTyped ? ": unknown" : ""}) { return value; }
function say(label${isTyped ? ": string" : ""}, run${isTyped ? ": () => string" : ""}) {
  let line;
  try {
    line = run();
  } catch (error) {
    line = "THROWS " + (error${isTyped ? " as Error" : ""}).constructor.name;
  }
  console.log(label + ": " + line);
}
${blocks.join("\n")}
${isTyped ? "export {};\n" : ""}`,
  };
}
