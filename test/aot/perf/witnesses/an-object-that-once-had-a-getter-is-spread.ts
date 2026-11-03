// An object whose getter has become a plain value, and one with a getter that is not enumerable, are copied as any other object: their properties are read out of the table, not looked up one by one.
// process.env is such an object: the host makes each value at its first read.
type Anything = Record<string, unknown>;
function once(names: number): Anything {
  const object: Anything = {};
  for (let i = 0; i < names; i++) object["NAME_" + i] = "value " + i;
  Object.defineProperty(object, "NAME_3", { get() { return "got"; }, enumerable: true, configurable: true });
  Object.defineProperty(object, "NAME_3", { value: "value 3", writable: true, enumerable: true, configurable: true });
  Object.defineProperty(object, "HIDDEN", { get() { throw new Error("read"); }, enumerable: false, configurable: true });
  return object;
}
const source = once(40);
function forChild(extra: string): Anything { return { ...source, EXTRA: extra }; }
function withLayout(extra: string) { return { ...source, EXTRA: extra, OTHER: 1 }; }
let sum = 0;
for (let i = 0; i < 20000; i++) {
  const first = forChild(i & 1 ? "a" : "bc");
  const second = withLayout(i & 1 ? "d" : "ef");
  sum = (sum + (first.EXTRA as string).length + (first.NAME_3 as string).length + second.EXTRA.length + second.OTHER) | 0;
}
console.log(sum);
