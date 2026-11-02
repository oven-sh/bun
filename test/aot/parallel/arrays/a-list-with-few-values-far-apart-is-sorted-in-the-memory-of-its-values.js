// `a[40_000_000] = 1` gives a list storage that is far shorter than the list. sort() with a comparator made a copy as long as the list: 8 bytes an index, and a RangeError from 2 ** 28 indexes on.
function describe(list) {
  const keys = Object.keys(list);
  const first = keys.slice(0, 8).map(key => `${key}=${String(list[key])}`);
  return `${list.length} long, ${keys.length} of its own: ${first.join(" ")}`;
}
const byDifference = (x, y) => x - y;
const byOrder = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

// What the process has held at most, in kilobytes.
const far = [];
far[40_000_000] = 1;
far[0] = 2;
const before = process.resourceUsage().maxRSS;
far.sort((x, y) => x - y);
console.log(describe(far), "| grew by less than 128 MB:", process.resourceUsage().maxRSS - before < 128 * 1024);

// As many values as the copy has room for at first, one fewer, one more, and the same each time it grows.
for (const count of [2, 3, 15, 16, 17, 31, 32, 33, 63, 64, 65, 127, 128, 129, 1000]) {
  for (const comparator of [byDifference, byOrder]) {
    const list = [];
    let sum = 0;
    for (let i = 0; i < count; i++) {
      const value = (i * 7919) % 1009;
      list[20_000 + i * 97] = value;
      sum += value;
    }
    list.sort(comparator);
    let isOrdered = true;
    for (let i = 1; i < count; i++) isOrdered &&= list[i - 1] <= list[i];
    for (let i = 0; i < count; i++) sum -= list[i];
    console.log(count, comparator.name, isOrdered, sum, count in list, Object.keys(list).length, list.length);
  }
}

const mixed = [];
mixed[50_000] = "b";
mixed[3] = undefined;
mixed[70_000] = "a";
mixed[60_000] = undefined;
mixed[9] = "c";
mixed.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
console.log(describe(mixed));

const seen = [];
const watched = [];
watched[40_000] = 1;
watched[2] = 2;
Object.defineProperty(watched, 1, {
  get() {
    seen.push("get");
    return 3;
  },
  set(value) {
    seen.push(`set ${value}`);
  },
  configurable: true,
  enumerable: true,
});
watched.sort((x, y) => x - y);
console.log(describe(watched), "|", seen.join());

function nameOfError(run) {
  try {
    run();
    return "no error";
  } catch (error) {
    return error.constructor.name;
  }
}

const held = [];
held[40_000] = 1;
held[0] = 2;
Object.defineProperty(held, 30_000, { value: 0, writable: true, enumerable: true, configurable: false });
console.log(nameOfError(() => held.sort((x, y) => x - y)), describe(held));

const frozen = [];
frozen[40_000] = 1;
frozen[0] = 2;
Object.freeze(frozen);
console.log(nameOfError(() => frozen.sort((x, y) => x - y)), describe(frozen));

// Storage for numbers is as long as the list, holes and all.
const numbers = [2.5, , 0.5, , 1.5];
numbers.sort((x, y) => x - y);
console.log(describe(numbers));
const manyNumbers = [];
for (let i = 0; i < 300; i++) if (i % 3) manyNumbers[i] = ((i * 7919) % 1009) + 0.5;
manyNumbers.sort((x, y) => y - x);
console.log(describe(manyNumbers), manyNumbers[199], 200 in manyNumbers);
