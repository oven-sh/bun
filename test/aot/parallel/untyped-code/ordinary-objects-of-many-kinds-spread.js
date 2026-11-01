// `{ ...source }` of ordinary objects of three hundred kinds in turn, each filled under names that are put together: what the copies hold, that they are objects of their own,
// and that the run time is not asked for a copy however many kinds there are. What may not be copied word by word is copied as the language says.
// Only the jsc shell can count. Elsewhere the program checks the answers alone.
// Env: JSC_aotCountsPath=/dev/null
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const visits = () => count("operationAOTCopyObject");
const sources = [];
for (let kind = 0; kind < 300; kind++) {
  const source = {};
  for (let i = 0; i <= kind % 6; i++) source["k" + kind + "n" + i] = kind * 10 + i;
  sources.push(source);
}
const copyOf = (o) => ({ ...o });
const digest = (o) => Object.keys(o).join() + "=" + Object.values(o).join();
let sum = 0;
const round = () => { for (const source of sources) sum += copyOf(source)["k7n1"] === 71 ? 1 : 0; };
for (let i = 0; i < 20; i++) round();
const before = visits();
for (let i = 0; i < 100; i++) round();
const visited = visits() - before;
console.log(sum, digest(copyOf(sources[0])), "|", digest(copyOf(sources[5])), "|", digest(copyOf(sources[299])));
console.log(visited <= 300 ? "the run time is asked for at most one copy in a hundred of 30000, of 300 kinds in turn" : "the run time is asked for " + visited + " copies of 30000");

// A copy is an object of its own.
const first = copyOf(sources[4]);
const [nameOfFirst] = Object.keys(first);
first[nameOfFirst] = "changed";
first[nameOfFirst + "more"] = 1;
console.log(digest(first), "|", digest(sources[4]), "|", digest(copyOf(sources[4])), copyOf(sources[4]) !== sources[4]);

// What a copy leaves behind, and what it reads.
const odd = (change) => { const o = {}; o["a" + sources.length] = 1; o["b" + sources.length] = 2; change(o); return o; };
const describe = (o) => Reflect.ownKeys(o).map((key) => { const d = Object.getOwnPropertyDescriptor(o, key); return String(key) + ":" + String(d.value) + (d.writable ? "w" : "-") + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-"); }).join() + " " + Object.isExtensible(o) + " " + (Object.getPrototypeOf(o) === Object.prototype);
const changes = [
  (o) => {},
  (o) => Object.freeze(o),
  (o) => Object.seal(o),
  (o) => Object.preventExtensions(o),
  (o) => Object.defineProperty(o, "hidden", { value: 3, enumerable: false, writable: true, configurable: true }),
  (o) => Object.defineProperty(o, "fixed", { value: 3, enumerable: true, writable: false, configurable: true }),
  (o) => Object.defineProperty(o, "kept", { value: 3, enumerable: true, writable: true, configurable: false }),
  (o) => Object.defineProperty(o, "got", { get() { return "by the getter"; }, enumerable: true, configurable: true }),
  (o) => Object.setPrototypeOf(o, { inherited: 1 }),
  (o) => Object.setPrototypeOf(o, null),
  (o) => { o[Symbol.for("s")] = 4; },
  (o) => { o[0] = "element"; },
  (o) => { delete o["a" + sources.length]; },
  (o) => { for (let i = 0; i < 20; i++) o["more" + i] = i; },
  (o) => { Object.defineProperty(o, "__proto__", { value: 5, enumerable: true, writable: true, configurable: true }); },
  (o) => { Object.create(o); },
];
for (const change of changes) {
  let last;
  for (let i = 0; i < 3; i++) last = describe(copyOf(odd(change)));
  console.log(last);
}
class Branded { constructor(o) { return o; } }
class Brands extends Branded { #mark() { return "marked"; } static has(o) { return #mark in o; } }
const marked = new Brands(odd(() => {}));
console.log(Brands.has(marked), Brands.has(copyOf(marked)), describe(copyOf(marked)));
