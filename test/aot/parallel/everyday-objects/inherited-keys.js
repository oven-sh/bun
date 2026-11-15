// for in over inherited keys, hasOwn, in, and null prototypes
function list(n) {
  const base = { shared: n, over: n + 1 };
  const child = Object.create(base, { own: { value: n + 2, enumerable: true }, hidden: { value: 0 } });
  child.over = n + 3;
  const all = [];
  for (const key in child) all.push(key + (Object.hasOwn(child, key) ? "!" : "") + child[key]);
  const bare = Object.assign(Object.create(null), child);
  return all.join() + " " + ["hidden", "toString", "none"].map(key => key in child).join() + " " + ("toString" in bare) + Object.keys(bare).join();
}
console.log(list(1));
console.log(list(40));
console.log(list(0));
