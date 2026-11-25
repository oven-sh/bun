// The inner for-of steps what the outer one hands out. The list is written to hold texts; some of the lists below do, some lie.
function codes(words: string[]): string {
  let sum = 0, count = 0;
  for (const word of words) { for (const letter of word) { sum += letter.codePointAt(0)!; count++; } }
  return sum + "/" + count;
}
function joined(words: string[]): string {
  let out = "";
  for (const word of words) { for (const letter of word) out += "[" + letter + "]"; out += "|"; }
  return out;
}
function first(words: string[], wanted: string): number {
  let at = 0;
  for (const word of words) { for (const letter of word) { if (letter === wanted) return at; at++; } }
  return -1;
}
function tried(run: () => unknown): string {
  try { return String(run()); } catch (error) { return (error as Error).constructor.name; }
}
const hidden = <T,>(value: T): T => JSON.parse(JSON.stringify({ value })).value;
const plain = hidden(["alpha", "be", "", "c"]);
const wide = hidden(["café", "中文", "a😀b", "\ud83d", "\ude00\ud83d", ""]);
const ropes = [plain[0] + wide[2]!, wide[1] + plain[1]! + plain[3], plain[2] + plain[2]!];
for (let turn = 0; turn < 3; turn++) {
  console.log(codes(plain), codes(wide), codes(ropes), codes([]));
  console.log(joined(plain), joined(wide), joined(ropes));
  console.log(first(plain, "e"), first(wide, "😀"), first(wide, "\ud83d"), first(ropes, "z"));
}
const counted = { *[Symbol.iterator]() { yield "x"; yield "yz"; } };
const lies: unknown[][] = [
  [["ab", "c"], "d"],
  [new Set(["q", "rs"]), "t"],
  [new String("boxed"), "u"],
  [counted, "v"],
  ["w", 7],
  ["w", undefined],
  ["w", null],
  ["w", {}],
  [new Map([["k", "v"]])],
];
for (const list of lies) {
  console.log(tried(() => codes(list as string[])), tried(() => joined(list as string[])), tried(() => first(list as string[], "c")));
}
console.log(codes(plain), joined(wide));
const grown = ["ab"];
let seen = "";
for (const word of grown) { for (const letter of word) { seen += letter; if (grown.length < 4) grown.push(letter + letter); } }
console.log(seen, grown.join());
export {};
