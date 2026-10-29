// Short strings built at run time and used as keys come from a cache of recent keys. Equal keys find the same entries while the cache grows, evicts keys and loses them to collections.
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));

// The same text, built in a way the compiler does not look through.
function spell(parts: (string | number)[]): string {
  return parts.map(part => String(part)).join("").split("").join("");
}

const distinctKeyCount = 70000;
const counts = new Map<string, number>();
const sums: Record<string, number> = {};
function countKeys(start: number, end: number): void {
  for (let i = start; i < end; i++) {
    const key = "k" + (i % distinctKeyCount);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    sums[key] = (sums[key] ?? 0) + i;
  }
}
function describeCounts(): string {
  let total = 0;
  let weighted = 0;
  for (const [key, count] of counts) {
    total += count;
    weighted += count * key.length;
  }
  let sum = 0;
  for (const key in sums) sum += sums[key];
  return [counts.size, total, weighted, Object.keys(sums).length, sum].join(" ");
}
function countMismatches(): number {
  let mismatches = 0;
  for (let i = 0; i < distinctKeyCount; i += 997) {
    const key = "k" + i;
    const spelled = spell(["k", i]);
    if (key !== spelled || key.length !== spelled.length) mismatches++;
    if (!counts.has(spelled) || counts.get(key) !== counts.get(spelled) || sums[key] !== sums[spelled]) mismatches++;
    if (counts.has("q" + i) || counts.has("k" + i + "x") || "q" + i in sums) mismatches++;
  }
  return mismatches;
}
countKeys(0, 100000);
console.log("the first 100000:", describeCounts(), countMismatches());
collect();
countKeys(100000, 200000);
console.log("200000:", describeCounts(), countMismatches());
collect();
collect();
countKeys(0, 200000);
console.log("the same keys again:", describeCounts(), countMismatches());

const byNumber = new Map<string, number>();
for (let i = 0; i < 60000; i++) byNumber.set(String(i * 7), i);
let numbersFound = 0;
for (let i = 0; i < 60000; i++) {
  if (byNumber.get("" + i * 7) === i) numbersFound++;
  if (byNumber.has(i * 7 + 1 + "")) numbersFound--;
}
console.log("numbers as keys:", byNumber.size, numbersFound, byNumber.get(spell([419993])));

const words = ["Accept", "Cache", "Content", "Control", "Encoding", "Forwarded", "Host", "Language", "Length", "Location", "Modified", "Origin", "Range", "Type", "Upgrade", "X"];
const headerNames: string[] = [];
for (let i = 0; i < 300; i++) headerNames.push(words[i % words.length] + "-" + words[(i * 5 + 3) % words.length] + "-" + i);
function convertHeaderNames(): string {
  const lowered = new Map<string, number>();
  let checksum = 0;
  let wrong = 0;
  for (let i = 0; i < headerNames.length; i++) {
    const name = headerNames[i];
    const lower = name.toLowerCase();
    const upper = name.toUpperCase();
    lowered.set(lower, (lowered.get(lower) ?? 0) + 1);
    if (lower.toUpperCase() !== upper || upper.toLowerCase() !== lower || lower.length !== name.length) wrong++;
    if (lower !== spell([lower]) || upper !== spell([upper])) wrong++;
    checksum += lower.charCodeAt(0) + upper.charCodeAt(1) * (i + 1);
  }
  return [lowered.size, checksum, wrong, headerNames[7].toLowerCase(), headerNames[299].toUpperCase()].join(" ");
}
console.log("300 header names:", convertHeaderNames());
console.log("again:", convertHeaderNames());
collect();
console.log("after a collection:", convertHeaderNames());

const codes = (text: string): string => Array.from(text, character => character.codePointAt(0)!.toString(16)).join(".");
const oddCases = ["straße", "ÉtÉ", "ÿes", "5µm", "naïve", "İx", "ﬁx", "ǅ"];
for (let round = 0; round < 2; round++) {
  for (const text of oddCases) console.log("case of", codes(text), "is", codes(text.toLowerCase()), "and", codes(text.toUpperCase()));
}

const byLength = new Map<string, number>();
const convertedLengths: number[] = [];
for (const length of [2, 3, 63, 64, 65, 66, 1000]) {
  const prefix = "P".repeat(length - 1);
  for (let round = 0; round < 3; round++) {
    for (let digit = 0; digit < 10; digit++) {
      const key = prefix + digit;
      byLength.set(key, (byLength.get(key) ?? 0) + 1);
      sums[key] = (sums[key] ?? 0) + digit;
      const lower = key.toLowerCase();
      if (lower.length !== length || lower[0] !== "p" || lower[length - 1] !== String(digit) || lower.toUpperCase() !== key) convertedLengths.push(length);
    }
  }
}
let lengthsSeen = "";
for (const [key, count] of byLength) {
  if (key.endsWith("7")) lengthsSeen += key.length + ":" + count + ":" + sums[spell([key])] + " ";
}
console.log("keys of 2 to 1000 characters:", byLength.size, lengthsSeen + "wrong conversions:", convertedLengths.length);

const wide = new Map<string, number>();
for (let i = 0; i < 3000; i++) {
  const beyondLatin1 = "kĀ" + (i % 1000);
  const lastOfLatin1 = "kÿ" + (i % 1000);
  const astral = "\u{1f600}" + (i % 1000);
  wide.set(beyondLatin1, (wide.get(beyondLatin1) ?? 0) + 1);
  wide.set(lastOfLatin1, (wide.get(lastOfLatin1) ?? 0) + 2);
  wide.set(astral, (wide.get(astral) ?? 0) + 3);
}
console.log("characters at and above U+00FF:", wide.size, wide.get("kĀ" + 5), wide.get(spell(["kÿ", 5])), wide.get("\u{1f600}" + 999), wide.has("k" + 5), wide.has("kā" + 5));

let narrowedFound = 0;
for (let i = 0; i < 2000; i++) {
  const narrowed = ("kĀ" + i).replace("Ā", "");
  if (counts.get(narrowed) === counts.get("k" + i) && sums[narrowed] === sums["k" + i] && narrowed === "k" + i) narrowedFound++;
}
console.log("Latin-1 texts cut out of wider strings:", narrowedFound);

const tiny = new Map<string, number>();
const tinySums: Record<string, number> = {};
const letters = "abcdefghij";
for (let i = 0; i < 1000; i++) {
  const digit = "" + (i % 10);
  const letter = letters.slice(i % 10, (i % 10) + 1) + letters.slice(3, 3);
  const empty = letters.slice(i % 10, i % 10) + letters.slice(5, 5);
  for (const key of [digit, letter, empty]) {
    tiny.set(key, (tiny.get(key) ?? 0) + 1);
    tinySums["_" + key] = (tinySums["_" + key] ?? 0) + 1;
    tinySums[key] = (tinySums[key] ?? 0) + 1;
  }
}
console.log("keys of one and no characters:", tiny.size, tiny.get(""), tiny.get("7"), tiny.get("c"), tinySums[""], tinySums["7"], tinySums["c"], tinySums["_"], tinySums["_7"], Object.keys(tinySums).length);
