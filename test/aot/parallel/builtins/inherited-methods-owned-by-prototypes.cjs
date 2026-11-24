// A built-in function that stands above another object is given, as its own, what it inherits: a property that is there stays as writable as it is.
const told = (label, f) => { let line = label + " "; try { const d = f(); line += [typeof d.value, d.writable, d.enumerable, d.configurable].join(); } catch (e) { line += e.name; } console.log(line); };
for (const [label, f] of [["native", Math.max], ["library", Array.prototype.map], ["constructor", WeakRef], ["string", String.prototype.at]]) {
  Object.defineProperty(f, "call", { value: f.call, writable: true, configurable: true });
  const below = Object.create(f);
  told(label, () => Object.getOwnPropertyDescriptor(Object.defineProperty(f, "call", { value: f.call, enumerable: true }), "call"));
  told(label, () => Object.getOwnPropertyDescriptor(Object.defineProperty(f, "call", { value: f.call, enumerable: false }), "call"));
  told(label, () => Object.getOwnPropertyDescriptor(Object.defineProperty(f, "call", { value: Function.prototype.call, writable: true }), "call"));
  console.log(below.call === f.call, typeof below.apply, Object.keys(f).join());
}
console.log(Math.max.call(null, 1, 2), [1, 2].map.call([3], x => x + 1).join());
