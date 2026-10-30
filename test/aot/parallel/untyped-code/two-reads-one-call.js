// Two reads by name that compile to one stub call (`a.b.c`, `[a.x, a.y]`, `[a.x, b.y]`) and a read fused with its test (`if (a.flag)`, `a.kind === "leaf"`), on plain objects, class instances, getters and proxies. When one of the reads throws, the error names that read's property and its stack has that read's line and column. Five rows of `sameReceiverOnTwoLines` differ from plain Bun: its transpiler puts a constant that is used once in the place of its use, so the read of `const x = a.x` is reported a line below where it stands.
const lines = [];
const say = (...parts) => lines.push(parts.map(String).join(" "));
const show = value => {
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "object" && value !== null) return "object";
  if (typeof value === "function") return "function";
  return Object.is(value, -0) ? "-0" : String(value);
};

const reads = {
  chain: a => a.b.c,
  chainOnTwoLines: a =>
    a.b
      .c,
  chainKeepingFirst(a) {
    const b = a.b;
    const c = b.c;
    return [b, c];
  },
  chainInLoop(a) {
    let last;
    for (let i = 0; i < 2; i++) last = a.b.c;
    return last;
  },
  sameReceiver: a => [a.x, a.y],
  sameReceiverOnTwoLines(a) {
    const x = a.x;
    const y = a.y;
    return [x, y];
  },
  twoReceivers: (a, b) => [a.x, b.y],
  twoReceiversOnTwoLines(a, b) {
    const x = a.x;
    const y = b.y;
    return [x, y];
  },
  twoReceiversInLoop(a, b) {
    const seen = [];
    for (let i = 0; i < 2; i++) seen.push(a.x, b.y);
    return seen;
  },
  truthy(a) {
    if (a.flag) return "set";
    return "clear";
  },
  equalsLeaf: a => (a.kind === "leaf" ? "leaf" : "other"),
};

const ran = [];
let throwsOn;
const check = key => {
  ran.push(key);
  if (key === throwsOn) throw new RangeError("getter of " + key);
};

// Plain Bun quotes the expression and compiled code quotes the property. Both end in the name that was read.
const named = error => /(\w+)'\)$/.exec(error.message)?.[1] ?? error.message;
const site = error => {
  for (const line of String(error.stack).split("\n")) {
    const frame = /at (\w+) \(.*:(\d+:\d+)\)$/.exec(line);
    if (frame && frame[1] in reads) return frame[1] + ":" + frame[2];
  }
  return "no frame";
};
const run = (read, a, b) => {
  let answer;
  try {
    answer = show(read(a, b));
  } catch (error) {
    answer = error.constructor.name + " " + named(error) + " at " + site(error);
  }
  return ran.length ? answer + " after " + ran.splice(0).join() : answer;
};

class Fields {
  constructor(v) {
    this.b = v.b;
    this.c = v.c;
    this.x = v.x;
    this.y = v.y;
    this.flag = v.flag;
    this.kind = v.kind;
  }
}
class Derived extends Fields {
  extra = 1;
}
class Getters {
  #v;
  constructor(v) {
    this.#v = v;
  }
  get b() { check("b"); return this.#v.b; }
  get c() { check("c"); return this.#v.c; }
  get x() { check("x"); return this.#v.x; }
  get y() { check("y"); return this.#v.y; }
  get flag() { check("flag"); return this.#v.flag; }
  get kind() { check("kind"); return this.#v.kind; }
}
class Leaf {
  constructor(index) {
    this.c = index * 2;
  }
}
class Tree {
  constructor(index) {
    this.b = new Leaf(index);
    this.c = "tree";
    this.x = index;
    this.y = index + 0.5;
    this.flag = index % 2 === 0;
    this.kind = index % 3 ? "leaf" : "node";
  }
}

const shapes = {
  literal: v => ({ b: v.b, c: v.c, x: v.x, y: v.y, flag: v.flag, kind: v.kind }),
  outOfLine: v => {
    const object = {};
    for (let i = 0; i < 40; i++) object["p" + i] = i;
    return Object.assign(object, shapes.literal(v));
  },
  inherited: v => Object.create(shapes.literal(v)),
  inheritedOutOfLine: v => Object.create(shapes.outOfLine(v)),
  absent: () => ({ unrelated: 1 }),
  fields: v => new Fields(v),
  derived: v => new Derived(v),
  tree: v => new Tree(v.index),
  ownGetters: v => ({
    get b() { check("b"); return v.b; },
    get c() { check("c"); return v.c; },
    get x() { check("x"); return v.x; },
    get y() { check("y"); return v.y; },
    get flag() { check("flag"); return v.flag; },
    get kind() { check("kind"); return v.kind; },
  }),
  classGetters: v => new Getters(v),
  proxy: v =>
    new Proxy(shapes.literal(v), {
      get(target, key, receiver) {
        check(key);
        return Reflect.get(target, key, receiver);
      },
    }),
  function: v => Object.assign(function () {}, shapes.literal(v)),
  array: v => Object.assign([], shapes.literal(v)),
  nullPrototype: v => Object.assign(Object.create(null), shapes.literal(v)),
  frozen: v => Object.freeze(shapes.literal(v)),
};
const shapeNames = Object.keys(shapes);

const halves = ["lea", "f"];
const kinds = ["leaf", halves[0] + halves[1], "a leaf".slice(2), "leafĀ".slice(0, 4), "leaves", "LEAF", "lea", "", new String("leaf"), 4, null, undefined];
const flags = [true, false, 0, -0, 1, 1.5, NaN, "", "a", null, undefined, {}, [], 0n, 1n, Symbol.iterator, () => {}];
const values = [0, -0, 1, -1, 1.5, NaN, 2 ** 31, "s", "", true, null, undefined, 10n, Symbol.iterator, {}];
const valuesAt = index => ({
  index,
  c: values[index % values.length],
  x: values[(index + 1) % values.length],
  y: values[(index + 2) % values.length],
  flag: flags[index % flags.length],
  kind: kinds[index % kinds.length],
});

// The first round misses every cache, the later rounds hit them.
for (const [position, shapeName] of shapeNames.entries()) {
  const inner = shapes[shapeNames[(position + 1) % shapeNames.length]];
  const other = shapes[shapeNames[(position + 2) % shapeNames.length]];
  for (const [readName, read] of Object.entries(reads)) {
    const rounds = [];
    for (let round = 0; round < 3; round++) {
      const answers = [];
      for (let index = 0; index < flags.length; index++) {
        const v = valuesAt(index);
        answers.push(run(read, shapes[shapeName]({ ...v, b: inner(v) }), other(v)));
      }
      rounds.push(answers.join(" | "));
    }
    say(shapeName, readName, rounds[0]);
    if (rounds[1] !== rounds[0] || rounds[2] !== rounds[0]) say(shapeName, readName, "changes between rounds:", rounds[1], "||", rounds[2]);
  }
}

const v = valuesAt(2);
for (const shapeName of ["ownGetters", "classGetters", "proxy"]) {
  const make = shapes[shapeName];
  for (const key of ["b", "c", "x", "y", "flag", "kind"]) {
    for (const [readName, read] of Object.entries(reads)) {
      throwsOn = key;
      say(shapeName, "throws on", key, readName, run(read, make({ ...v, b: make(v) }), make(v)));
      throwsOn = undefined;
    }
  }
}

for (const nothing of [undefined, null]) {
  for (const [readName, read] of Object.entries(reads)) {
    say("first receiver is", nothing, readName, run(read, nothing, shapes.literal(v)));
    for (const shapeName of ["literal", "outOfLine", "inherited", "fields", "ownGetters", "classGetters", "proxy"])
      say("second receiver is", nothing, "after", shapeName, readName, run(read, shapes[shapeName]({ ...v, b: nothing }), nothing));
  }
}

for (const primitive of ["text", 7, 1.5, true, 10n, Symbol.iterator]) {
  for (const [readName, read] of Object.entries(reads)) {
    say("first receiver is a", typeof primitive, readName, run(read, primitive, primitive));
    say("second receiver is a", typeof primitive, readName, run(read, shapes.literal({ ...v, b: primitive }), primitive));
  }
}

// A getter that runs as the first read changes what the second read must find.
const changes = {
  deletesSecond: () => ({ get x() { delete this.y; return "x"; }, y: "y" }),
  addsSecond: () => ({ get x() { this.y = "added"; return "x"; } }),
  redefinesSecond: () => ({ get x() { Object.defineProperty(this, "y", { get: () => "computed", configurable: true }); return "x"; }, y: "y" }),
  replacesPrototype: () => Object.setPrototypeOf({ get x() { Object.setPrototypeOf(this, { y: "new prototype" }); return "x"; } }, { y: "old prototype" }),
  growsReceiver: () => ({ get x() { for (let i = 0; i < 40; i++) this["q" + i] = i; return "x"; }, y: "y" }),
};
for (const [changeName, make] of Object.entries(changes)) {
  for (let round = 0; round < 3; round++) {
    const shared = make();
    say(changeName, round, run(reads.sameReceiver, make()), run(reads.sameReceiverOnTwoLines, make()), run(reads.twoReceivers, shared, shared), run(reads.twoReceiversInLoop, make(), make()));
  }
}

let turn = 0;
const rotating = {
  get b() {
    const make = shapes[shapeNames[turn % shapeNames.length]];
    return make(valuesAt(turn++));
  },
};
for (let i = 0; i < 2 * shapeNames.length; i++) say("rotating", i, run(reads.chain, rotating), run(reads.chainKeepingFirst, rotating), run(reads.chainInLoop, rotating));

console.log(lines.join("\n"));
