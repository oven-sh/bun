// Forty scopes a row. A declared function of the scope names an object that a WeakRef knows, and is only ever called by other functions of the scope. Between the place where the
// functions of the scope are made and the place where the ways part stands a read that may throw. The object is there for as long as a function of the scope is.
const kept = [];
const rows = [];
function row(name, make) {
  const weak = [];
  for (let n = 0; n < 40; n++) {
    try {
      kept.push(make(n, weak));
    } catch (error) {
      kept.push(error.message.length);
    }
  }
  rows.push({ name, weak });
}
const watched = (weak, value) => (weak.push(new WeakRef(value)), value);
const handedOut = [];

function scope(held, node, extra) {
  function report(scale) {
    return better(scale) + kind + extra.length;
  }
  function better(scale) {
    return held.n * scale;
  }
  function again() {
    return report(1) + report(2);
  }
  const kind = node.kind;
  switch (kind) {
    case 0:
      return () => report(3);
    case 1:
      handedOut.push(again);
      return kind;
    case 2:
      return again;
    default:
      return kind;
  }
}
row("a function of the scope leaves by one way of four", (n, weak) => scope(watched(weak, { n }), { kind: 0 }, "a"));
row("a function of the scope is handed out", (n, weak) => scope(watched(weak, { n }), { kind: 1 }, "ab"));
row("a function that calls two leaves", (n, weak) => scope(watched(weak, { n }), { kind: 2 }, "abc"));
row("the read throws", (n, weak) => scope(watched(weak, { n }), n & 1 ? null : { kind: 0 }, "abcd"));

function storedLate(make, node, weak) {
  let held;
  const reads = () => (held ? held.n : -1);
  const unread = () => held;
  const kind = node.kind;
  held = make(weak);
  if (kind) return reads;
  return () => reads() + 1;
}
row("the variable is stored behind the read", (n, weak) => storedLate(w => watched(w, { n }), { kind: n & 1 }, weak));

class Holder {
  self = () => this;
  held;
  label = "none";
  constructor(held, node) {
    this.held = held;
    this.label = node.label;
    if (node.flag) handedOut.push(this.self);
  }
}
row("an instance with a closure over it", (n, weak) => new Holder(watched(weak, { n }), { label: "l" + n, flag: n & 1 }).self);
row("an instance whose constructor throws", (n, weak) => new Holder(watched(weak, { n }), n % 3 ? { label: "x", flag: true } : null).self);

for (let round = 0; round < 4; round++) {
  await new Promise(resolve => setTimeout(resolve, 1));
  Bun.gc(true);
}
for (const { name, weak } of rows) {
  const there = weak.filter(reference => reference.deref() !== undefined).length;
  console.log(name + ":", there, "of", weak.length);
}
let sum = 0;
for (const value of [...kept, ...handedOut]) {
  const answer = typeof value === "function" ? value() : value;
  sum += typeof answer === "number" ? answer : answer.held.n;
}
console.log(sum, kept.length, handedOut.length);
