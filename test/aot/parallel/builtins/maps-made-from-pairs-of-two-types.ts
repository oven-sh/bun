// Maps made from pairs whose keys and values differ in type, walked by keys, by values and by pairs, with and without a use of the key: every walk sees what plain Bun sees.
const words = ["a", "bb", "ccc", "dddd", "e", "ff", "ggg", "hhhh", "i"];
const byNumber: Map<number, string> = new Map(words.map((w, i): [number, string] => [i * 1.5, w]));
const byWord: Map<string, number> = new Map(words.map((w, i): [string, number] => [w, i * 1.5]));
const byObject: Map<object, number> = new Map(words.map((w, i): [object, number] => [{ w }, i]));
const toObject: Map<number, { w: string }> = new Map(words.map((w, i): [number, { w: string }] => [i, { w }]));
const byEither: Map<number | string, string | number> = new Map<number | string, string | number>(
  words.map((w, i): [number | string, string | number] => (i % 2 ? [i, w] : [w, i])),
);
const wordsAlone: Map<number | string, string | number> = new Map<number | string, string | number>(
  words.map((w, i): [number | string, string | number] => [w, i]),
);
function numberKeys(map: Map<number, unknown>): number {
  let t = 0;
  for (const k of map.keys()) t += k;
  return t;
}
function wordKeys(map: Map<string, unknown>): number {
  let t = 0;
  for (const k of map.keys()) t += k.length;
  return t;
}
function wordValues(map: Map<unknown, string>): number {
  let t = 0;
  for (const v of map.values()) t += v.length;
  return t;
}
function numberValues(map: Map<unknown, number>): number {
  let t = 0;
  for (const v of map.values()) t += v;
  return t;
}
function objectValues(map: Map<unknown, { w: string }>): string {
  let t = "";
  for (const v of map.values()) t += v.w;
  return t;
}
function count(map: Map<unknown, unknown>): number {
  let t = 0;
  for (const _ of map.values()) t++;
  return t;
}
function listed(map: Map<unknown, unknown>): string {
  const all: string[] = [];
  for (const [k, v] of map) all.push(JSON.stringify(k) + "=" + JSON.stringify(v));
  return all.join(" ");
}
for (let round = 0; round < 3; round++) {
  console.log(
    numberKeys(byNumber),
    wordValues(byNumber),
    wordKeys(byWord),
    numberValues(byWord),
    numberValues(byObject),
    numberKeys(toObject),
    objectValues(toObject),
  );
  console.log(count(byNumber), count(byWord), count(byObject), count(toObject), count(byEither), count(wordsAlone));
  let either = "";
  for (const v of byEither.values()) either += typeof v === "string" ? v : v + 1;
  for (const k of byEither.keys()) either += typeof k === "number" ? k * 2 : k.length;
  for (const v of wordsAlone.values()) either += typeof v === "string" ? v : v + 1;
  for (const k of wordsAlone.keys()) either += typeof k === "number" ? k * 2 : k.length;
  console.log(either);
}
for (const map of [byNumber, byWord, byObject, toObject, byEither, wordsAlone]) console.log(listed(map));
byNumber.delete(1.5);
byNumber.set(-0, "zero");
byWord.delete("bb");
byWord.set("more", NaN);
console.log(
  numberKeys(byNumber),
  wordValues(byNumber),
  wordKeys(byWord),
  numberValues(byWord),
  listed(byNumber),
  listed(byWord),
);
