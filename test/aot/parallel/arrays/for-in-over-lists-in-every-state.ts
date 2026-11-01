// for-in over lists in every odd state: holes, names of their own, names on the prototypes, lists changed by the body of the loop.
function total(list: number[]): number {
  let sum = 0;
  for (const key in list) sum += list[key];
  return sum;
}
function keysOf(list: unknown[]): string {
  let text = "";
  for (const key in list) text += key + ":" + typeof key + ",";
  return text;
}
function popping(list: number[]): string {
  let text = "";
  for (const key in list) { text += key + "=" + list[key] + ","; list.pop(); }
  return text;
}
function pushing(list: number[]): string {
  let text = "";
  for (const key in list) { text += key + ","; if (list.length < 12) list.push(1); }
  return text;
}
function deletingAhead(list: number[]): string {
  let text = "";
  for (const key in list) { text += key + ","; delete list[Number(key) + 1]; }
  return text;
}
function fillingAHole(list: number[]): string {
  let text = "";
  for (const key in list) { text += key + ","; list[1] = 7; }
  return text;
}
function storing(list: number[], other: Record<string, number>): string {
  for (const key in list) { list[key] = list[key] * 2; other[key] = list[key]; }
  return list.join() + JSON.stringify(other);
}
function turningIntoTexts(list: unknown[]): string {
  let text = "";
  for (const key in list) { text += key + "=" + list[key] + ","; list[Number(key) + 1] = "t"; if (list.length > 6) break; }
  return text;
}
function has(list: number[]): string {
  let text = "";
  for (const key in list) text += (key in list) + "," + Object.hasOwn(list, key) + "," + delete list[key] + ";";
  return text + list.length;
}
function nested(list: number[][]): number {
  let sum = 0;
  for (const row in list) for (const column in list[row]) sum += list[row][column] * (Number(row) + 1);
  return sum;
}
function throwing(list: number[]): string {
  let text = "";
  try {
    for (const key in list) {
      try {
        if (list[key] === 2) throw new Error("two at " + key);
        text += key;
      } finally {
        text += ";";
      }
    }
  } catch (error) {
    text += (error as Error).message;
  }
  return text;
}
function* yielding(list: string[]): Generator<string> {
  for (const key in list) yield key + list[key];
}
async function awaiting(list: number[]): Promise<number> {
  let sum = 0;
  for (const key in list) sum += await Promise.resolve(list[key]);
  return sum;
}
function capturing(list: number[]): string {
  const readers: (() => string)[] = [];
  for (const key in list) readers.push(() => key + "=" + list[key]);
  list[0] = 9;
  return readers.map(reader => reader()).join();
}
function skipping(list: number[][]): string {
  let text = "";
  outer: for (const row in list) {
    for (const column in list[row]) {
      if (list[row][column] === 0) continue outer;
      if (list[row][column] < 0) break outer;
      text += row + column + ",";
    }
  }
  return text;
}
function assigned(list: number[]): string {
  let key: string | number = -1;
  for (key in list) if (list[key as any] > 1) break;
  return typeof key + key;
}
function ofArguments(...rest: number[]): number {
  let sum = 0;
  for (const key in rest) sum += rest[key] * (Number(key) + 1);
  return sum;
}
function long(count: number): number {
  const list: number[] = [];
  for (let i = 0; i < count; i++) list.push(i);
  let sum = 0;
  for (const key in list) sum += list[key] + key.length;
  return sum;
}
const lines: unknown[] = [];
for (let round = 0; round < 3; round++) {
  const holey = [1, , 3, , 5] as number[];
  const named = Object.assign([1.5, 2.5], { extra: 10, more: 20 }) as number[];
  const frozen = Object.freeze([1, 2, 3]) as number[];
  const sparse: number[] = []; sparse[100000] = 4; sparse[3] = 5;
  const hidden = [1, 2, 3]; Object.defineProperty(hidden, 1, { value: 9, enumerable: false });
  const getter = [1, 2, 3]; Object.defineProperty(getter, 0, { get() { return 40; }, enumerable: true, configurable: true });
  lines.push(total([1, 2, 3]), total([0.5, 1.5]), total([]), total(holey), total(named), total(frozen), total(sparse), total(hidden), total(getter));
  lines.push(keysOf([1, "a", null]), keysOf(holey), keysOf(named), keysOf(sparse), keysOf(hidden), keysOf(new Array(3)), keysOf(Array.from({ length: 12 }, (_, i) => i)));
  lines.push(popping([1, 2, 3, 4, 5]), pushing([1, 2, 3]), deletingAhead([1, 2, 3, 4, 5]), fillingAHole([1, , 3] as number[]), fillingAHole([1, 2, 3]));
  lines.push(storing([1, 2, 3], {}), storing([0.5, 1.5], {}), turningIntoTexts([1, 2, 3]), has([1, 2, 3]), nested([[1, 2], [3], [], [4, 5, 6]]));
  lines.push(throwing([1, 2, 3]), throwing([1, 3]), [...yielding(["a", "b"])].join(), await awaiting([1, 2, 3.5]), capturing([1, 2]), skipping([[1, 2], [3, 0, 4], [5], [-1], [6]]));
  lines.push(assigned([1, 2, 3]), assigned([]), ofArguments(1, 2, 3), ofArguments(), long(1200), long(0));
  if (round === 1) (Array.prototype as any).added = 100;
}
delete (Array.prototype as any).added;
class Rows extends Array<number> { tag = 5; }
const rows = new Rows(); rows.push(1, 2);
lines.push(total(rows), keysOf(rows), keysOf(Object.setPrototypeOf([1, 2], { inherited: 1, 5: 2 })));
console.log(lines.join("\n"));
