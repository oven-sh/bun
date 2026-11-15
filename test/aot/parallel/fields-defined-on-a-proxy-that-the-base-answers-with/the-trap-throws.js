class Base {
  constructor(refuses) {
    return new Proxy({}, {
      defineProperty(target, key, descriptor) {
        if (refuses && key === "second") throw new RangeError("refused " + key);
        return Reflect.defineProperty(target, key, descriptor);
      },
    });
  }
}
let reached = 0;
class Heir extends Base {
  first = ++reached;
  second = ++reached;
  third = ++reached;
}
for (let turn = 0; turn < 50; ++turn) {
  try { new Heir(turn % 2 === 1); } catch (error) { reached += error instanceof RangeError ? 100 : 100000; }
}
console.log(reached);
