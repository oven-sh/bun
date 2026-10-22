// String keys longer than 2,048 characters are compared with property names instead of being atomized: flat strings and ropes in reads, `in` and stores, on an object that owns an equal name, on one that owns a name of equal length, through a prototype and a proxy, and on an object with 5,000 names.
// COUNTER: LongKeyComparisonLimitReached >= 1
const turns = JSON.parse("40");
const box = JSON.parse("[0]");
function hidden(value) { box[0] = value; return box[0]; }
function said(run) { try { return String(run()); } catch (error) { return "threw " + error.constructor.name; } }
const lines = [];
function say(label, ...values) { lines.push(label + ": " + values.map(String).join(" ")); }

const length = JSON.parse("3000");
const flat = "k".repeat(length);
const half = hidden("k".repeat(length / 2));
const rope = () => half + half;
const piece = hidden("k".repeat(length / 60));
function deepRope() {
  let text = piece;
  for (let i = 1; i < 60; i++) text += piece;
  return text;
}
const other = "k".repeat(length - 1) + "x";
const short = "k".repeat(length - 1000);
const keys = [
  ["flat", () => flat],
  ["rope", rope],
  ["rope of 60 pieces", deepRope],
  ["other", () => other],
  ["short", () => short],
];
say("keys", flat.charCodeAt(0), flat.length, rope().length, deepRope().length, other.length, short.length);

let trapped = 0;
const owner = Object.create(null);
owner[rope()] = "flat";
owner[short] = "short";
const lookalike = Object.create(null);
lookalike["k".repeat(length - 1) + "x"] = "other";
const child = Object.create(owner);
const empty = Object.create(null);
const proxy = new Proxy(owner, {
  get(target, key, receiver) { trapped++; return Reflect.get(target, key, receiver); },
  has(target, key) { trapped++; return key in target; },
});
const crowded = Object.create(null);
for (let i = 0; i < 5000; i++) crowded["n" + i] = i;
crowded[rope()] = "crowded";
const receivers = [["owner", owner], ["lookalike", lookalike], ["child", child], ["empty", empty], ["proxy", proxy], ["crowded", crowded]];

function readAndTest(o, createKey) {
  const answers = new Set();
  for (let i = 0; i < turns; i++) {
    const key = createKey();
    answers.add(String(o[key]) + " " + (key in o));
  }
  return [...answers].join("|");
}
function readAndTestEach(stage) {
  for (const [name, o] of receivers) say(stage + ", " + name, keys.map(([label, createKey]) => label + " = " + readAndTest(o, createKey)).join(", "));
}
function store(o, first) {
  for (let i = 0; i < turns; i++) o[rope()] = first + i;
}

readAndTestEach("before the stores");
store(owner, 100);
say("replaced in the owner", owner[flat], Object.keys(owner).length);
store(empty, 200);
say("added to the empty object", empty[flat], Object.keys(empty).length);
store(child, 300);
say("added to the child", child[flat], Object.keys(child).length, owner[flat]);
readAndTestEach("after the stores");
delete owner[rope()];
readAndTestEach("after the delete");
Object.freeze(empty);
say("replaced in a frozen object", said(() => store(empty, 400)), empty[flat]);
Object.preventExtensions(lookalike);
say("added to a non-extensible object", said(() => store(lookalike, 500)), Object.keys(lookalike).length);
say("proxy traps", trapped);

console.log(lines.join("\n"));
