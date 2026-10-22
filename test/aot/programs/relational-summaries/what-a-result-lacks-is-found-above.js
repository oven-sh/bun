// A member that a helper stores on one path only is not `undefined` on the other: the read goes on to the prototype that the literal names.
// And a store is no store where the prototype has a setter, or a member that may not be written.
const lines = [];
function onOnePath(c, v, above) {
  const o = { __proto__: above, always: v };
  if (c) o.maybe = v;
  return o;
}
function onEveryPath(v, above) {
  const o = { __proto__: above, always: v };
  o.maybe = v;
  return o;
}
function never(v, above) {
  return { __proto__: above, always: v };
}
function changedLater(c, v, above) {
  const o = { always: v };
  if (c) o.maybe = v;
  Object.setPrototypeOf(o, above);
  return o;
}
function count(name, f) {
  const seen = new Map();
  for (let i = 0; i < 300; i++) {
    let what;
    try {
      what = f(i);
    } catch (e) {
      what = "throws a " + e.constructor.name;
    }
    seen.set(what, (seen.get(what) ?? 0) + 1);
  }
  lines.push(name + ": " + [...seen].map(([k, n]) => String(k) + " x" + n).join(", "));
}
const mine = "mine";
let reads = 0;
const taken = [];
const kinds = {
  "nothing above": {},
  "null above": null,
  "a value above": { maybe: "from above" },
  "an accessor above": {
    get maybe() {
      reads++;
      return "from the getter above";
    },
    set maybe(v) {
      taken.push(v);
    },
  },
  "a getter alone above": {
    get maybe() {
      return "from the getter alone";
    },
  },
  "a frozen value above": Object.freeze({ maybe: "frozen above" }),
  "two steps above": Object.create({ maybe: "from two steps above" }),
};
for (const [name, above] of Object.entries(kinds)) {
  count(name + ", one path", i => onOnePath(i % 3 === 0, mine, above).maybe);
  count(name + ", every path", i => onEveryPath(mine, above).maybe);
  count(name + ", never", i => never(mine, above).maybe);
  count(name + ", changed later", i => changedLater(i % 3 === 0, mine, above).maybe);
  count(name + ", own", i => Object.hasOwn(onEveryPath(mine, above), "maybe"));
}
lines.push("the getter ran " + reads + " times, the setter took " + taken.length);
console.log(lines.join("\n"));
