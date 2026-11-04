// A literal that lists fields is filled by spreads of literals in sight, and what comes later stores into it, compares it, freezes it and collects garbage round it.
function deed(i) {
  const base = { a: i, b: 1 };
  const made = { c: 2, ...base, d: 3, ...base, e: 4 };
  const same = made;
  made.a = "stored";
  base.a = "source";
  Bun.gc(true);
  Object.freeze(made);
  return [made === same, made === base, JSON.stringify(made), JSON.stringify(base), Object.isFrozen(made), Object.isFrozen(base)].join(" ");
}
console.log(deed(1));
let last = "";
for (let i = 0; i < 40; i++) last = deed(i);
console.log(last);
