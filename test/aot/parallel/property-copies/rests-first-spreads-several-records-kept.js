// The rest of a pattern and the first spread of a literal take one of several records, over and over, and what they make is kept, listed and read. Between the rounds the records change: fields go, come back, change their kind, become accessors, and the records are frozen; copies become prototypes; the heap is collected.
const kept = [];
const tag = Symbol("tag");
function makeRecords() {
  return [
    { id: 6, name: "six", secret: "w", age: 20 },
    { secret: "y", id: 8, name: "eight" },
    { name: "nine", secret: "z", id: 9, age: 3, more: 1 },
    { id: 2 ** 31, name: "", secret: "", age: -1, more: 0.5 },
    { more: -0, age: NaN, id: -(2 ** 31) - 1, secret: null, name: undefined },
    { id: null, name: null, age: undefined, more: true, secret: undefined },
    { name: ["a", "list"], id: { inner: 1 }, secret: 1, age: 10n, more: tag },
    { id: 1e300, secret: "s", more: () => "called", name: "last" },
  ];
}

function restOf(records, i) {
  const { secret, ...visible } = records[i % records.length];
  kept[i & 7] = visible;
  return visible;
}
function restWithoutTwo(records, i) {
  const { secret, age, ...visible } = records[i % records.length];
  kept[i & 7] = visible;
  return visible;
}
function restWithoutAKey(records, i, key) {
  const { [key]: left, ...visible } = records[i % records.length];
  kept[i & 7] = visible;
  return visible;
}
function spreadOf(records, i) {
  const copy = { ...records[i % records.length] };
  kept[i & 7] = copy;
  return copy;
}
function spreadAndMore(records, i) {
  const copy = { ...records[i % records.length], last: i & 1 };
  kept[i & 7] = copy;
  return copy;
}
function spreadOfTwo(records, i) {
  const copy = { ...records[i % records.length], ...records[(i + 3) % records.length] };
  kept[i & 7] = copy;
  return copy;
}

function describe(value) {
  if (typeof value === "function") return "function " + value();
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return String(value);
  if (Object.is(value, -0)) return "-0";
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return typeof value + " " + String(value);
}
function list(made) {
  return Reflect.ownKeys(made)
    .map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(made, key);
      return `${String(key)}=${describe(descriptor.value)}${descriptor.writable && descriptor.enumerable && descriptor.configurable ? "" : "!"}`;
    })
    .join(" ");
}
function checksumOf(text, sum) {
  for (let at = 0; at < text.length; at++) sum = (Math.imul(sum, 31) + text.charCodeAt(at)) | 0;
  return sum;
}

const makers = [
  restOf,
  restWithoutTwo,
  (records, i) => restWithoutAKey(records, i, i & 1 ? "id" : "more"),
  spreadOf,
  spreadAndMore,
  spreadOfTwo,
];
function round(label, records, turns) {
  const sums = [];
  for (const make of makers) {
    let sum = 0;
    for (let i = 0; i < turns; i++) sum = checksumOf(list(make(records, i)), sum);
    sums.push(sum);
  }
  console.log(label, sums.join(" "));
  for (let i = 0; i < records.length; i++)
    console.log(
      " ",
      i,
      "|",
      list(restOf(records, i)),
      "|",
      list(spreadOf(records, i)),
      "|",
      list(spreadOfTwo(records, i)),
    );
}

let records = makeRecords();
for (let warm = 0; warm < 3; warm++) round("as made " + warm, records, 400);

Bun.gc(true);
round("behind a collection", records, 400);

delete records[0].age;
delete records[2].name;
records[1].age = 77;
round("fields gone and come", records, 400);
records[0].age = "back";
records[2].name = 5;
round("fields back with other kinds", records, 400);

records = makeRecords();
records[0].id = 1.5;
records[1].id = "text";
records[2].more = undefined;
records[3].name = null;
round("other kinds in the same fields", records, 400);

records = makeRecords();
let reads = 0;
Object.defineProperty(records[0], "age", {
  get() {
    reads++;
    return reads;
  },
  enumerable: true,
  configurable: true,
});
Object.defineProperty(records[1], "name", { value: "hidden", enumerable: false });
Object.defineProperty(records[2], "id", { value: 99, writable: false });
round("an accessor, a hidden field and a field that is read only", records, 40);
console.log("reads", reads);

records = makeRecords();
Object.defineProperty(records[0], "id", {
  get() {
    delete records[0].age;
    records[0].added = "while copied";
    return "got";
  },
  enumerable: true,
  configurable: true,
});
console.log(list(restOf(records, 0)), "|", list(spreadOf(records, 0)), "|", list(records[0]));

records = makeRecords();
Object.freeze(records[0]);
Object.seal(records[1]);
Object.preventExtensions(records[2]);
round("frozen, sealed, not extensible", records, 400);
console.log(
  Object.isFrozen(restOf(records, 0)),
  Object.isSealed(spreadOf(records, 1)),
  Object.isExtensible(spreadOf(records, 2)),
);

records = makeRecords();
records[0][tag] = "by a symbol";
records[1][3] = "by an index";
records[2]["__proto__x"] = 1;
Object.defineProperty(records[3], "__proto__", {
  value: { inherited: "no" },
  enumerable: true,
  writable: true,
  configurable: true,
});
round("a symbol, an index and __proto__", records, 400);
console.log(
  Object.getPrototypeOf(spreadOf(records, 3)) === Object.prototype,
  Object.getPrototypeOf(restOf(records, 3)) === Object.prototype,
  spreadOf(records, 3).inherited,
);

records = makeRecords();
const above = restOf(records, 0);
const below = Object.create(above);
const readBelow = () => `${below.id} ${below.name} ${below.age} ${below.more} ${"secret" in below}`;
console.log(readBelow());
for (let i = 0; i < 400; i++) restOf(records, i);
above.more = "added above";
console.log(readBelow(), list(above), list(restOf(records, 0)));
const empty = {};
Object.setPrototypeOf(below, spreadOf(records, 2));
console.log(readBelow(), list(empty));
round("a copy is a prototype", records, 400);

records = makeRecords();
let total = 0;
for (let i = 0; i < 60000; i++) {
  const made = i & 1 ? restOf(records, i) : spreadOf(records, i);
  total = (total + Object.keys(made).length + (typeof made.id === "number" ? made.id | 0 : 1)) | 0;
  if (i % 20000 === 19999) Bun.gc(true);
}
console.log(total, kept.map(list).join(" / "));

for (const other of [
  null,
  undefined,
  1,
  "ab",
  true,
  tag,
  3n,
  [],
  [1, 2],
  new Map([[1, 2]]),
  function named() {},
  new (class Point {
    x = 1;
    y = 2;
  })(),
  Object.create({ inherited: 1 }, { own: { value: 2, enumerable: true } }),
]) {
  const mixed = [other === null || other === undefined ? {} : other, { id: 1, secret: 2, name: "n" }];
  console.log(
    describe(typeof other),
    list({ ...other }),
    "|",
    list(restOf(mixed, 0)),
    "|",
    list(restOf(mixed, 1)),
    "|",
    list(spreadOf(mixed, 0)),
  );
}
