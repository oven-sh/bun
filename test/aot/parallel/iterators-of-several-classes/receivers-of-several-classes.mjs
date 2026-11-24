const out = [];

function look(holder, key) {
  const held = holder.get(key);
  out.push(typeof held === "object" ? "object " + held.k : String(held));
}

function lookThenStore(holder, key, value) {
  look(holder, key);
  holder.set(key, value);
  look(holder, key);
}

function copyOf(from) {
  const list = [];
  from.forEach(v => list.push(v));
  for (const v of list) out.push(typeof v === "object" ? "object " + v.k : String(v));
}

function chosen(n) {
  return n === 0 ? new Map([["a", 1]]) : n === 1 ? new WeakMap() : new Map([["b", { k: 2 }]]);
}

const key = { k: 0 };
lookThenStore(chosen(0), "a", { k: 1 });
lookThenStore(chosen(1), key, { k: 5 });
lookThenStore(chosen(2), "b", 3);
copyOf(new Set([1, "two"]));
copyOf([3, { k: 4 }]);
copyOf(new Map([["x", { k: 6 }], ["y", 7]]));
copyOf(new Float64Array([0.5]));

console.log(out.join(", "));
