const seen = [];
const inner = new Proxy(
  {},
  {
    getOwnPropertyDescriptor(target, key) {
      if (typeof key === "symbol") seen.push(key);
      return undefined;
    },
    ownKeys() {
      return [];
    },
    has() {
      return false;
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
console.log(seen.length > 0);
const mine = {};
for (const key of seen) mine[key] = () => "printed by the method";
console.log(mine);
