"use strict";
// Objects below literals: what they inherit lies in fields of compiled objects. Warm reads by name at sites that see many receivers; then the fields above are stored to by compiled code,
// with values of the same kind and of other kinds, emptied and filled again; behind each step the same reads.
const unknown = String(process.argv.length > 99 ? process.argv[99] : "");
let getterCalls = 0;
const top = {
  count: 1,
  ratio: 1.5,
  flag: true,
  text: "top text",
  list: [1, 2],
  child: { inner: "inner of top" },
  nothing: null,
  missing: undefined,
  method() {
    return "top.method of " + this.own;
  },
  arrow: () => "top.arrow",
  get computed() {
    getterCalls++;
    return "computed for " + this.own;
  },
};
const middle = Object.setPrototypeOf({ count: 10, middleText: "middle text", later: undefined }, top);
const makers = {
  parsed: () => Object.setPrototypeOf(JSON.parse('{"own":"parsed"}'), middle),
  created: () => Object.assign(Object.create(middle), { own: "created" }),
  belowTop: () => Object.assign(Object.create(top), { own: "belowTop" }),
  literal: () => Object.setPrototypeOf({ own: "literal", flag: false }, middle),
  literalWithMore: () => Object.assign(Object.setPrototypeOf({ own: "literalWithMore" }, top), { ["more" + unknown]: 1 }),
};
const readers = {
  own: o => o.own,
  count: o => o.count,
  ratio: o => o.ratio,
  flag: o => o.flag,
  text: o => o.text,
  list: o => o.list,
  child: o => o.child,
  inner: o => o.child?.inner,
  nothing: o => o.nothing,
  missing: o => o.missing,
  method: o => (typeof o.method === "function" ? o.method() : o.method),
  arrow: o => (typeof o.arrow === "function" ? o.arrow() : o.arrow),
  computed: o => o.computed,
  middleText: o => o.middleText,
  later: o => o.later,
};
const show = value => (typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));
const makeAll = () => Object.entries(makers).map(([kind, make]) => [kind, make()]);
function readAll(receivers) {
  const lines = [];
  for (const [kind, receiver] of receivers) {
    const words = [];
    for (const name in readers) words.push(name + "=" + show(readers[name](receiver)));
    lines.push(kind + ": " + words.join(" "));
  }
  return lines.join("\n");
}

const receivers = makeAll();
const warm = readAll(receivers);
for (let round = 0; round < 200; round++) {
  if (readAll(receivers) !== warm || readAll(makeAll()) !== warm) throw new Error("the reads changed by themselves in round " + round);
}
console.log(warm);

const steps = [
  ["values of the same kind", () => { top.count = 2; top.ratio = 2.5; top.flag = false; top.text = "second text"; top.list = [3]; top.child = { inner: "second inner" }; middle.count = 20; middle.middleText = "second middle text"; }],
  ["stored in a loop, read in between", () => { for (let i = 0; i < 300; i++) { top.count = i; top.text = "text " + (i & 3); for (const [, receiver] of receivers) if (readers.text(receiver) !== "text " + (i & 3)) throw new Error("stale text at " + i); if (readers.count(receivers[2][1]) !== i) throw new Error("stale count at " + i); } }],
  ["values of other kinds", () => { top.count = "a string now"; top.ratio = 7; top.flag = "yes"; top.text = 42; top.list = null; top.child = 1.25; top.nothing = { no: "longer nothing" }; top.missing = 0; }],
  ["undefined and null", () => { top.count = undefined; top.ratio = null; top.flag = undefined; top.text = null; top.child = undefined; middle.count = undefined; }],
  ["a field that was undefined is filled", () => { middle.later = "later is here"; top.missing = "no longer missing"; }],
  ["methods are replaced", () => { top.method = function second() { return "second method of " + this.own; }; top.arrow = "no function any more"; }],
  ["fields are deleted", () => { delete top.text; delete top.child; delete middle.count; delete middle.later; }],
  ["and stored again", () => { top.text = "text again"; top.child = { inner: "inner again" }; middle.count = 30; middle.later = "later again"; }],
  ["the getter becomes a value, a value a getter", () => { Object.defineProperty(top, "computed", { value: "a plain value", writable: true, configurable: true, enumerable: true }); Object.defineProperty(top, "ratio", { get() { return "ratio for " + this.own; }, configurable: true, enumerable: true }); }],
];
for (const [what, change] of steps) {
  change();
  console.log("\n--- " + what);
  for (let round = 0; round < 40; round++) {
    const now = readAll(receivers);
    const fresh = readAll(makeAll());
    if (round === 0 || round === 39) console.log(now + "\n- new objects\n" + fresh);
  }
}
console.log("the getter ran", getterCalls, "times");
