// Calls on rare paths with two arguments and more behind the instance, of every kind of result. Their slow ways really run here, and each function reads its parameters behind them.
type Item = { weight: number };

function storeAt(list: unknown[], index: number, value: unknown, tag: string, count: number): string {
  list[index] = value;
  return tag + index + ":" + count + ":" + list.length;
}

function storeNumber(list: number[], index: number, value: number, scale: number, offset: number): number {
  list[index] = value;
  return list.length * scale + index + offset;
}

function readKey(table: Record<string, unknown>, key: string, rounds: number, fallback: string): string {
  let last: unknown;
  for (let round = 0; round < rounds; round++) last = table[key];
  return String(last ?? fallback) + rounds + key;
}

function writeKey(table: Record<string, unknown>, key: string, value: unknown, rounds: number, tag: string): string {
  for (let round = 0; round < rounds; round++) table[key] = value;
  return tag + rounds + key + Object.keys(table).length;
}

function removeKey(table: Record<string, unknown>, key: string, tag: string, count: number): string {
  const removed = delete table[key];
  return tag + removed + key + count;
}

function hasKey(table: object, key: string, tag: string, count: number): string {
  const has = key in table;
  return tag + has + key + count;
}

function copyWith(source: object, extra: number, tag: string, count: number): string {
  const copy = { ...source, extra };
  return tag + JSON.stringify(copy) + extra + count;
}

class Secret {
  #hidden = 1;
  #other = "a";
  change(value: number, text: string, tag: string, count: number): string {
    this.#hidden = value;
    this.#other = text;
    return tag + this.#hidden + this.#other + value + text + count;
  }
  static read(thing: Secret, first: number, second: string): string {
    return thing.#hidden + second + first + thing.#other;
  }
}

class Base {
  name(first: string, second: number): string {
    return "base" + first + second;
  }
}
class Derived extends Base {
  name(first: string, second: number): string {
    return "derived" + super.name(first, second) + first + second;
  }
}

function joined(first: string, second: string, third: string, fourth: number): string {
  return first + second + third + fourth + first.toUpperCase() + second.toLowerCase() + third + fourth;
}

function mixed(first: unknown, second: unknown, third: number, fourth: string): string {
  const added = (first as number) + (second as number);
  const compared = (first as number) < (second as number);
  return String(added) + compared + third + fourth;
}

function fraction(first: unknown, second: unknown, third: number, fourth: number): number {
  const remainder = (first as number) % (second as number);
  const power = (first as number) ** (second as number);
  return remainder + power + third * fourth;
}

function pushBoth(list: Item[], first: Item, second: Item, tag: string): string {
  list.push(first, second);
  return tag + first.weight + second.weight + list.length;
}

function sliceOf(list: unknown[], start: number, end: number, tag: string): string {
  return tag + list.slice(start, end).length + start + end;
}

function serialized(value: unknown, spaces: number, tag: string, count: number): string {
  return tag + JSON.stringify(value, null, spaces) + spaces + count;
}

const lines: string[] = [];

const grown: unknown[] = [];
for (let index = 0; index < 200; index++) {
  const line = storeAt(grown, index * 2, index % 3 ? index : "text" + index, "t", index);
  if (index % 50 === 0) lines.push(line);
}
const numbers: number[] = [1, 2, 3];
let stored = 0;
for (let index = 0; index < 200; index++) stored += storeNumber(numbers, index * 3, index % 5 ? index + 0.5 : NaN, 2, index);
lines.push("stored " + stored + " " + numbers.length);

const tables: Record<string, unknown>[] = [{ alpha: 1 }, { beta: 2, alpha: 3 }, Object.create({ gamma: 4 }), JSON.parse('{"delta":5,"alpha":6}')];
const keys = ["alpha", "beta", "gamma", "delta", "missing"];
for (let index = 0; index < 40; index++) {
  const table = tables[index % tables.length];
  const key = keys[index % keys.length];
  const line = readKey(table, key, 1 + (index & 3), "none") + writeKey(table, key + (index % 7), index, 1 + (index & 1), "w") + hasKey(table, key, "h", index) + removeKey(table, key, "d", index);
  if (index % 9 === 0) lines.push(line);
}

for (const source of [{ a: 1 }, { a: 1, b: "two" }, Object.create({ hidden: 1 }), [1, 2], "text"]) lines.push(copyWith(source as object, 7, "c", 8));

const secret = new Secret();
for (let index = 0; index < 5; index++) lines.push(secret.change(index, "s" + index, "p", index * 2), Secret.read(secret, index, "r"));

const derived = new Derived();
for (let index = 0; index < 3; index++) lines.push(derived.name("n" + index, index));

for (let index = 0; index < 4; index++) lines.push(joined("Ab" + index, "Cd", "eF", index), joined("lower", "UPPER", "", index));

const operands: unknown[] = [1, 2.5, "3", null, undefined, true, { valueOf: () => 4 }, 2147483647, -1];
for (const first of operands) for (const second of operands) lines.push(mixed(first, second, 1, "m"), String(fraction(first, second, 3, 4)));

const items: Item[] = [];
for (let index = 0; index < 100; index++) {
  const line = pushBoth(items, { weight: index }, { weight: index * 2 }, "b");
  if (index % 25 === 0) lines.push(line);
}
lines.push(sliceOf(grown, 1, 9, "s"), sliceOf(items, -3, 500, "s"));
lines.push(serialized({ a: [1, { b: 2 }], c: "x" }, 2, "j", 1), serialized([undefined, () => 1, new Date(0)], 0, "j", 2));

console.log(lines.join("\n"));
