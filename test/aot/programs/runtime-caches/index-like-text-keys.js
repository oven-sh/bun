// A key that is the text of an array index names the element, and a text that only looks like one names a property.
function read(object, key) { return object[key]; }
function store(object, key, value) { object[key] = value; return object[key]; }
function has(object, key) { return key in object; }
function hasOwn(object, key) { return Object.hasOwn(object, key); }
function tryStore(object, key, value) { try { object[key] = value; return object[key]; } catch (error) { return error.constructor.name; } }

const indexTexts = ["0", "1", "2", "3", "7", "100", "4294967294"];
const otherTexts = ["00", "01", "1.0", "-0", "-1", "+1", "1e0", " 1", "1 ", "4294967295", "9007199254740993", "0x1", ""];
function argumentsOf() { return arguments; }
const receivers = {
  integers: () => [10, 11, 12],
  doubles: () => [0.5, 1.5, 2.5],
  texts: () => ["a", "b", "c"],
  holes: () => [10, , 12],
  empty: () => [],
  sparse: () => { const list = [10]; list[100] = 110; list[4294967294] = "last"; return list; },
  bytes: () => new Uint8Array([10, 11, 12]),
  floats: () => new Float64Array([0.5, 1.5, 2.5]),
  big: () => new BigInt64Array([10n, 11n, 12n]),
  object: () => ({ 0: "zero", 1: "one", 100: "hundred", "01": "padded" }),
  parsed: () => JSON.parse('{"0":"zero","2":"two","7":"seven","1.0":"decimal"}'),
  arguments: () => argumentsOf("x", "y", "z"),
  text: () => "abc",
  wrapper: () => new String("abc"),
  derived: () => Object.create([10, 11, 12]),
  getter: () => Object.defineProperty([10, 11, 12], "1", { get() { return "got"; }, configurable: true }),
  map: () => new Map([["0", 1]]),
};
for (const [kind, create] of Object.entries(receivers)) {
  for (let round = 1; round <= 3; round++) {
    const receiver = create();
    const line = [];
    for (const key of [...indexTexts, ...otherTexts]) {
      const isObject = typeof receiver === "object";
      line.push(`${JSON.stringify(key)}:${String(read(receiver, key))}/${isObject ? has(receiver, key) : "-"}/${isObject ? hasOwn(receiver, key) : "-"}`);
    }
    console.log(kind, round, line.join(" "));
  }
}

for (const [kind, create] of Object.entries(receivers)) {
  if (kind === "big" || kind === "text") continue;
  for (let round = 1; round <= 3; round++) {
    const receiver = create();
    const line = [];
    for (const key of ["1", "3", "01", "-0"]) line.push(`${key}=${String(tryStore(receiver, key, round * 2))}`);
    console.log(kind, round, "stored", line.join(" "), receiver.length, Object.keys(receiver).join());
  }
}

const kinds = [[1, 2, 3], [1, 2, 3], [1, 2, 3]];
console.log(store(kinds[0], "1", 1.5), store(kinds[1], "1", "text"), store(kinds[2], "1", { toString() { return "object"; } }) + "", kinds.map(list => list.join()).join("|"));

for (let round = 1; round <= 3; round++) {
  const frozen = Object.freeze([1, 2, 3]), sealed = Object.seal([1, 2, 3]), closed = Object.preventExtensions([1, 2, 3]);
  console.log("frozen", tryStore(frozen, "1", 9), tryStore(frozen, "3", 9), frozen.join());
  console.log("sealed", tryStore(sealed, "1", 9), tryStore(sealed, "3", 9), sealed.join());
  console.log("closed", tryStore(closed, "1", 9), tryStore(closed, "3", 9), closed.join());
}

const seen = [];
const proxy = new Proxy([10, 11], {
  get(target, key, receiver) { seen.push(`get ${typeof key} ${String(key)}`); return Reflect.get(target, key, receiver); },
  set(target, key, value, receiver) { seen.push(`set ${typeof key} ${String(key)}`); return Reflect.set(target, key, value, receiver); },
  has(target, key) { seen.push(`has ${typeof key} ${String(key)}`); return Reflect.has(target, key); },
});
console.log(read(proxy, "1"), read(proxy, 1), store(proxy, "0", 5), has(proxy, "1"), seen.join());

const digits = ["1", "2"];
const list = []; for (let i = 0; i < 30; i++) list.push(i * 2);
let total = 0;
for (let round = 0; round < 1000; round++) total += read(list, digits[round & 1] + digits[(round >> 1) & 1]);
console.log(total);
for (const key in list) total += read(list, key);
for (const key of Object.keys(list)) total += store(list, key, 1);
console.log(total, list.join(""));
