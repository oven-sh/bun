// Members of a literal that are arrow functions without captures, and one over the object itself. The objects reach code that nobody has seen.
function one(): number { return 1; }
function two(): number { return 2; }

function makeReader(id: number) {
  const reader = {
    id,
    readFirstPart: () => one(),
    readSecondPart: () => two(),
    readBothParts: () => one() + two(),
    readFourthPart: () => 4,
    readFifthPart: (left: number, right: number) => left + right,
    readSixthPart: () => 6,
    readOwnIdentity: () => reader.id,
  };
  return reader;
}

const unseen = new Function("reader", "action", `
  switch (action) {
  case "call": return reader.readFirstPart() + reader.readOwnIdentity();
  case "replace": reader.readFirstPart = () => 100; return reader.readFirstPart();
  case "number": reader.readSecondPart = 7; return reader.readSecondPart;
  case "undefined": reader.readBothParts = undefined; return "readBothParts" in reader;
  case "delete": return delete reader.readFourthPart;
  case "getter": Object.defineProperty(reader, "readFifthPart", { get() { return () => "from a getter"; }, configurable: true, enumerable: true }); return reader.readFifthPart();
  case "tag": reader.readSixthPart.tag = "kept"; return reader.readSixthPart.tag;
  case "freeze": Object.freeze(reader); return Object.isFrozen(reader);
  }
`);

function describe(reader: any): string {
  const parts: string[] = [];
  for (const key in reader) parts.push(key + ":" + typeof reader[key]);
  return parts.join() + " | " + Object.keys(reader).length + " | " + JSON.stringify(reader);
}

let sum = 0;
const kept: any[] = [];
for (let i = 0; i < 3000; i++) {
  const reader = makeReader(i);
  sum += reader.readFirstPart() + (i % 7 === 0 ? reader.readSecondPart() : 0) + reader.readFifthPart(i, 1);
  if (i % 300 === 0) kept.push(reader);
}
console.log(sum, kept.length);

const [a, b, c, d, e, f, g, h, untouched] = kept;
console.log(a.readFirstPart === a.readFirstPart, a.readFirstPart === b.readFirstPart, a.readOwnIdentity(), b.readOwnIdentity());
console.log(typeof a.readBothParts, a.readFourthPart.name, a.readFifthPart.length, a.readSixthPart.call(null), a.readFifthPart.apply(null, [2, 3]));
console.log(unseen(a, "call"), unseen(b, "replace"), b.readFirstPart(), describe(b));
console.log(unseen(c, "number"), c.readSecondPart, c.readFirstPart(), describe(c));
console.log(unseen(d, "undefined"), d.readBothParts, d.readOwnIdentity(), describe(d));
console.log(unseen(e, "delete"), "readFourthPart" in e, e.readFourthPart, e.readSixthPart(), describe(e));
console.log(unseen(f, "getter"), f.readFifthPart(), f.readFirstPart(), describe(f));
console.log(unseen(g, "tag"), g.readSixthPart.tag, h.readSixthPart.tag, describe(g));
console.log(unseen(h, "freeze"), h.readBothParts(), h.readBothParts === h.readBothParts, describe(h));

const copy = { ...untouched };
const assigned = Object.assign({}, untouched);
console.log(copy.readFirstPart === untouched.readFirstPart, assigned.readOwnIdentity === untouched.readOwnIdentity, copy.readOwnIdentity(), describe(copy));
console.log([1, 2, 3].map(untouched.readFourthPart).join(), [untouched.readSixthPart].map(each => each()).join());
const seen = new WeakMap<object, string>();
seen.set(untouched.readSecondPart, "found");
console.log(seen.get(untouched.readSecondPart), seen.has(kept[9].readSecondPart), Object.getOwnPropertyDescriptor(untouched, "readBothParts")!.writable);
console.log(Object.entries(untouched).map(([key, value]) => key + "=" + (typeof value === "function" ? (value as Function).name : value)).join());
