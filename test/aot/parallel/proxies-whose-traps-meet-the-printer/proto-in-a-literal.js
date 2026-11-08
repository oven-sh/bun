const seen = [];
const inner = new Proxy(
  {},
  {
    getOwnPropertyDescriptor(target, key) {
      if (typeof key === "symbol") seen.push(key);
      return undefined;
    },
  },
);
const outer = new Proxy(inner, {
  get() {
    return "a";
  },
});
const below = { __proto__: outer };
console.log(below);
console.log(seen.length > 0);
const mine = {};
for (const key of seen) mine[key] = () => "printed by the method";
console.log(mine);
