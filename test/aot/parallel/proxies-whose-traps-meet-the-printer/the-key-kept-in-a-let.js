let kept;
const inner = new Proxy(
  {},
  {
    getOwnPropertyDescriptor(target, key) {
      if (typeof key === "symbol" && !kept) kept = key;
      return undefined;
    },
  },
);
const below = Object.create(
  new Proxy(inner, {
    get() {
      return "a";
    },
  }),
);
console.log(below);
console.log(typeof kept);
const mine = {};
if (kept) mine[kept] = () => "printed by the method";
console.log(mine);
