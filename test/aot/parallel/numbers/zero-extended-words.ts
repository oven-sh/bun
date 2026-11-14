const ints: number[] = JSON.parse("[" + Array.from({ length: 48 }, (_, k) => (k * 37) % 101).join() + "]");
const doubles: number[] = JSON.parse("[" + Array.from({ length: 48 }, (_, k) => k * 1.5 + 0.25).join() + "]");
const starts: any[] = JSON.parse("[3, 1, 47, -1, 48, 0, -2147483648, 2147483647, 4294967295, 2147483648, 0.5, 31]");
const words = new Int32Array(48).map((_, k) => Math.imul(k, 0x9e3779b1));
const unsignedWords = new Uint32Array(words);
const bytes = new Uint8Array(words);
const text = "the quick brown fox jumps over the lazy dogs and cats";
let calls = 0;
function same(value: number) {
  calls++;
  return value;
}
function copy(from: number[], to: number[]) {
  for (let i = 0; i < from.length; i++) to[i] = from[i];
  return to.join();
}
function update(step: number) {
  for (let i = 0; i < words.length; i++) words[i] += step;
  for (let i = 0; i < unsignedWords.length; i++) unsignedWords[i & 31]++;
  for (let i = 0; i < ints.length; i++) ints[i] += step;
  return words.join() + unsignedWords.join() + ints.join();
}
function acrossCalls(start: any) {
  let sum = 0;
  const a = words[start & 31], b = unsignedWords[start & 15], c = bytes[start & 7] | 0;
  for (let i = start & 7; i < 40; i++) {
    const j = (i * 5) & 31;
    const x = same(ints[j]), y = same(doubles[j + 1]);
    sum = (sum + ints[j] + x + (bytes[i] ?? 9) + (unsignedWords[j] >>> (i & 31)) + y + a + b + c) % 1000003;
    ints[j] = ints[(j + 1) & 31] ^ i;
  }
  return sum;
}
function unsigned(start: any) {
  let line = "";
  for (let i = (start >>> 0) - 3, turns = 0; turns < 6; i++, turns++) {
    const word = i >>> 0;
    line += word + ":" + (word * 0.5) + ":" + (words[word] ?? "-") + ":" + text[word] + ":" + (word < 40 ? ints[word] : -word) + " ";
  }
  return line;
}
function chosen(start: any, wide: boolean) {
  const word = (start | 0) + 1;
  const index = wide ? word >>> 0 : word & 15;
  const other = word > 5 ? word >>> 1 : ~word >>> 28;
  return index + other * 2 + "," + (doubles[index] ?? "none") + "," + (ints[other] ?? "none") + "," + (index < other) + "," + (1 << index) + "," + (index ^ other);
}
for (const start of starts) console.log(acrossCalls(start), unsigned(start), chosen(start, true), chosen(start, false), calls);
console.log(copy(ints, doubles.slice()), copy(doubles, ints.slice()), update(3), update(-0x70000000));
for (const start of starts) console.log(acrossCalls(start), unsigned(start), chosen(start, true), chosen(start, false), calls);
