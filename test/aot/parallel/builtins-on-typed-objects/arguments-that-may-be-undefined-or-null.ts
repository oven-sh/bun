// Arguments of built-ins whose declared type is an object type, and arguments that are read out of lists and so may be undefined. Each call also runs with undefined, null, primitives, a proxy and a function.
interface Options { target: object; record: Record<string, number>; prototype: object | null; key: string }
function createOptions(values: any): Options {
  return { target: values.target, record: values.record, prototype: values.prototype, key: values.key };
}
const parsed: any = JSON.parse('{"target":{"a":1,"b":2},"record":{"x":3},"prototype":{"p":4},"key":"a"}');

const calls: Record<string, (o: Options) => unknown> = {
  entries: o => Object.entries(o.record),
  values: o => Object.values(o.record),
  keys: o => Object.keys(o.target),
  ownKeys: o => Reflect.ownKeys(o.target),
  getPrototypeOf: o => Object.getPrototypeOf(o.target) === Object.prototype,
  reflectGetPrototypeOf: o => Reflect.getPrototypeOf(o.target) === Object.prototype,
  create: o => Object.getPrototypeOf(Object.create(o.prototype)) === o.prototype,
  reflectGet: o => Reflect.get(o.target, o.key),
  reflectHas: o => Reflect.has(o.target, o.key),
  hasOwn: o => Object.hasOwn(o.target, o.key),
  assign: o => Object.assign({}, o.target, o.record),
  isFrozen: o => Object.isFrozen(o.target),
  getOwnPropertyNames: o => Object.getOwnPropertyNames(o.target),
  getOwnPropertyDescriptor: o => Object.getOwnPropertyDescriptor(o.target, o.key),
  weakSetAdd: o => new WeakSet().add(o.target).has(o.target),
};
function show(run: (o: Options) => unknown, o: Options): string {
  try { return JSON.stringify(run(o)) ?? "undefined"; } catch (error) { return (error as Error).constructor.name; }
}
const usual = createOptions(parsed);
let total = 0;
for (let i = 0; i < 3000; i++) for (const name in calls) total += show(calls[name], usual).length;
console.log(total);
const odd: [string, unknown][] = [
  ["undefined", undefined], ["null", null], ["number", 7], ["text", "ab"], ["boolean", true], ["symbol", Symbol.iterator], ["bigint", 5n], ["list", [1, , 3]], ["function", function named(a: number) { return a; }],
  ["proxy", new Proxy({ a: 1 }, { ownKeys() { return ["a", "z"]; }, getOwnPropertyDescriptor(target, key) { return key === "z" ? { value: 9, enumerable: true, configurable: true } : Reflect.getOwnPropertyDescriptor(target, key); } })],
  ["object without prototype", Object.create(null)], ["instance", new (class Point { a = 1; get b() { return 2; } })()], ["frozen", Object.freeze({ a: 1 })], ["date", new Date(0)], ["map", new Map([["a", 1]])],
];
for (const field of ["target", "record", "prototype", "key"]) {
  for (const [name, value] of odd) {
    const o = createOptions({ ...parsed, [field]: value });
    console.log(field, name, Object.keys(calls).map(call => show(calls[call], o)).join(" "));
  }
}

// Flow sees every string that arrives here, and undefined where the index is past the end. Nobody passes null.
const texts: string[] = ["a,b,c", "d;e"], separators: string[] = [",", ";"];
function countPieces(text: string, separator: string): number { return text.split(separator).length; }
function pad(text: string, filler: string): string { return text.padStart(7, filler); }
function replaceFirst(text: string, pattern: string, replacement: string): string { return text.replace(pattern, replacement); }
const callbacks: ((n: number) => void)[] = [n => { total += n; }, n => { total -= n; }];
function each(list: number[], callback: (n: number) => void): void { list.forEach(callback); }
const lines: string[] = [];
for (let i = 0; i < 3000; i++) {
  const line = [countPieces(texts[i & 1], separators[i % 3]), pad(texts[i & 1], separators[i % 3]), replaceFirst(texts[i & 1], separators[i % 3], separators[(i + 1) % 3])].join(" ");
  try { each([1, 2], callbacks[i % 3]); } catch (error) { total += 100; }
  if (i < 6) lines.push(line);
}
console.log(lines.join("\n"), total);
