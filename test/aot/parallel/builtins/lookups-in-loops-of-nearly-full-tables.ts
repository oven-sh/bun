// Lookups in loops in maps and sets that hold as many keys as their index takes before it grows: many keys lie far from where their hash
// points, and a key that is absent is only known to be absent at the first free place. Keys that are there, keys that are not, many more
// of those than there are keys, and tables that have lost keys and got them back.
export {};

const lines: string[] = [];
function report(name: string, ...values: unknown[]) {
  lines.push(name + ": " + values.join(" "));
}

function sumOfNumbers(map: Map<number, number>, keys: number[]): number {
  let sum = 0;
  for (let i = 0; i < keys.length; i++) sum += map.get(keys[i]!) ?? -1;
  return sum;
}
function hasNumbers(map: Map<number, number>, keys: number[]): number {
  let count = 0;
  for (let i = 0; i < keys.length; i++) if (map.has(keys[i]!)) count++;
  return count;
}
function countOfNumbers(set: Set<number>, keys: number[]): number {
  let count = 0;
  for (let i = 0; i < keys.length; i++) if (set.has(keys[i]!)) count++;
  return count;
}
function countInRange(set: Set<number>, from: number, to: number, step: number): number {
  let count = 0;
  for (let key = from; key < to; key += step) if (set.has(key)) count++;
  return count;
}
function sumOfStrings(map: Map<string, number>, keys: string[]): number {
  let sum = 0;
  for (let i = 0; i < keys.length; i++) sum += map.get(keys[i]!) ?? -1;
  return sum;
}
function countOfStrings(set: Set<string>, keys: string[]): number {
  let count = 0;
  for (let i = 0; i < keys.length; i++) if (set.has(keys[i]!)) count++;
  return count;
}
function namesOfNumbers(map: Map<number, string>, keys: number[]): number {
  let length = 0;
  for (let i = 0; i < keys.length; i++) length += (map.get(keys[i]!) ?? "").length;
  return length;
}

const sizes = [9, 12, 13, 24, 48, 96, 97, 192, 254, 255, 384, 385, 1536, 3072];
const makers: [string, (i: number) => number][] = [
  ["ones", i => i],
  ["threes", i => i * 3],
  ["sevens below zero", i => -7 * i - 1],
  ["halves", i => i / 2 + 0.25],
  ["far apart", i => i * 1048583],
  ["over 32 bits", i => i * 4294967311],
];

for (const size of sizes) {
  for (const [name, keyAt] of makers) {
    const keys: number[] = [];
    const others: number[] = [];
    for (let i = 0; i < size; i++) keys.push(keyAt(i));
    for (let i = 0; i < size * 4; i++) others.push(keyAt(size + i));
    const map = new Map<number, number>();
    const names = new Map<number, string>();
    const set = new Set<number>();
    for (let i = 0; i < size; i++) {
      map.set(keys[i]!, i);
      names.set(keys[i]!, "n" + (i % 11));
      set.add(keys[i]!);
    }
    const title = size + " " + name;
    report(
      title,
      sumOfNumbers(map, keys),
      hasNumbers(map, keys),
      countOfNumbers(set, keys),
      namesOfNumbers(names, keys),
    );
    report(
      title + ", absent",
      sumOfNumbers(map, others),
      hasNumbers(map, others),
      countOfNumbers(set, others),
      namesOfNumbers(names, others),
    );

    for (let i = 0; i < size; i += 3) {
      map.delete(keys[i]!);
      set.delete(keys[i]!);
    }
    report(
      title + ", a third gone",
      sumOfNumbers(map, keys),
      hasNumbers(map, keys),
      countOfNumbers(set, keys),
      countOfNumbers(set, others),
    );
    for (let i = 0; i < size; i += 6) {
      map.set(keys[i]!, -i);
      set.add(keys[i]!);
    }
    report(
      title + ", a sixth back",
      sumOfNumbers(map, keys),
      hasNumbers(map, keys),
      countOfNumbers(set, keys),
      sumOfNumbers(map, others),
    );
  }

  const evens = new Set<number>();
  for (let i = 0; i < size; i++) evens.add(i * 2);
  report(
    size + " in a range",
    countInRange(evens, -size, size * 4, 1),
    countInRange(evens, 1, size * 8, 2),
    countInRange(evens, 0, size * 2, 0.5),
  );

  const texts: string[] = [];
  const otherTexts: string[] = [];
  for (let i = 0; i < size; i++) texts.push("key" + i);
  for (let i = 0; i < size * 4; i++) otherTexts.push("key" + (size + i));
  const byText = new Map<string, number>();
  const setOfTexts = new Set<string>();
  // A text gets its hash where it is first looked up.
  for (const text of otherTexts) byText.has(text);
  for (let i = 0; i < size; i++) {
    byText.set(texts[i]!, i);
    setOfTexts.add(texts[i]!);
  }
  const copies = texts.map(text => text.split("").join(""));
  for (const copy of copies) byText.has(copy);
  report(
    size + " texts",
    sumOfStrings(byText, texts),
    countOfStrings(setOfTexts, texts),
    sumOfStrings(byText, copies),
    countOfStrings(setOfTexts, copies),
  );
  report(size + " texts, absent", sumOfStrings(byText, otherTexts), countOfStrings(setOfTexts, otherTexts));
  for (let i = 1; i < size; i += 3) {
    byText.delete(texts[i]!);
    setOfTexts.delete(copies[i]!);
  }
  report(
    size + " texts, a third gone",
    sumOfStrings(byText, texts),
    countOfStrings(setOfTexts, copies),
    countOfStrings(setOfTexts, otherTexts),
  );
}

console.log(lines.join("\n"));
