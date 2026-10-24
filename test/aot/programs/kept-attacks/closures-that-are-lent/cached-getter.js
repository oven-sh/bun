// Closures that are lent: cached getter. It prints what plain Bun prints.
function cached(getter) {
  const set = false;
  return {
    get value() {
      if (!set) {
        const value = getter();
        Object.defineProperty(this, "value", { value });
        return value;
      }
      throw new Error("cached value already set");
    },
  };
}
function normalize(def) { return Object.keys(def.shape).length; }
function init(inst, def) {
  const normalized = cached(() => normalize(def));
  inst.run = () => normalized.value;
}
let sum = 0;
for (let i = 0; i < 300; i++) { const inst = {}; init(inst, { shape: { a: 1, b: i } }); sum += inst.run() + inst.run(); }
console.log(sum);
