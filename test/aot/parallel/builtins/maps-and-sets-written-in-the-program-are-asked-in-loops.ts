// `new Map([["ann", 30], ..])` and `new Set(["a", "e", ..])`, written out in the program, are asked by strings in loops: one long loop, a loop that never turns,
// a loop inside a loop, a loop under try, a loop that changes the collection, a loop inside one that awaits or yields, and a collection that is made anew by each call of a function.
export {};

const ages = new Map([["ann", 30], ["bob", 25], ["cy", 41], ["dee", 19]]);
const names = ["ann", "zed", "bob", "yan", "cy", "dee"];
let sum = 0;
for (let i = 0; i < 6000; i++) sum += ages.get(names[i % 6]!) ?? -1;
console.log("one long loop", sum, ages.size, [...ages.keys()].join());

const never = new Map([["ann", 1], ["bob", 2], ["cy", 3]]);
const nobody: string[] = [];
let found = 0;
for (const name of nobody) found += never.get(name) ?? 0;
console.log("a loop that never turns", found, never.size, [...never].join(";"), never.get("cy"), never.has("dee"));

function vowelsIn(text: string[]): number {
  const vowels = new Set(["a", "e", "i", "o", "u"]);
  let count = 0;
  for (let k = 0; k < text.length; k++) if (vowels.has(text[k]!)) count++;
  return count;
}
const letters = ["t", "h", "e", "q", "u", "i", "c", "k", "b", "r", "o", "w", "n", "f", "o", "x"];
let vowels = 0;
for (let i = 0; i < 300; i++) vowels += vowelsIn(letters) + vowelsIn(nobody);
console.log("a set made by each call", vowels);

function valueOf(words: (string | undefined)[]): number {
  const values = new Map([["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5], ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9], ["ten", 10]]);
  let total = 0;
  for (const word of words) total += values.get(word!) ?? 100;
  return total;
}
let total = 0;
for (let i = 0; i < 300; i++) total += valueOf(["one", "ten", undefined, "eleven", "six", "nine"]);
console.log("a map made by each call", total);

const tables = [new Set(["red", "green"]), new Set(["green", "blue", "white"]), new Set<string>(), new Set(["black"])];
const colors = ["red", "green", "blue", "white", "black", "pink"];
let hits = "";
for (const table of tables) {
  let count = 0;
  for (let round = 0; round < 50; round++) for (const color of colors) if (table.has(color)) count++;
  hits += count + " ";
}
console.log("a set picked by each turn of the outer loop", hits);

const guarded = new Map([["ann", 1], ["bob", 2]]);
let caught = 0;
try {
  for (let i = 0; i < 100; i++) {
    caught += guarded.get(names[i % 6]!) ?? 0;
    if (i === 70) throw new Error("at " + i);
  }
} catch (error) {
  console.log("a loop under try", caught, (error as Error).message, guarded.size);
} finally {
  for (const name of names) caught += guarded.has(name) ? 1 : 0;
}
console.log("behind finally", caught);

const changing = new Map([["ann", 1], ["bob", 2], ["cy", 3]]);
let seen = 0;
for (let i = 0; i < 60; i++) {
  const name = names[i % 6]!;
  seen += changing.get(name) ?? 0;
  if (i === 10) changing.set("zed", 50);
  if (i === 20) changing.delete("ann");
  if (i === 40) changing.clear();
  if (i === 50) changing.set("dee", 7);
}
console.log("a loop that changes the map", seen, [...changing].join(";"));

class Ranks extends Map<string, number> {
  best(): string {
    let best = "";
    for (const name of names) if ((this.get(name) ?? 0) > (this.get(best) ?? 0)) best = name;
    return best;
  }
}
console.log("a class below Map", new Ranks([["ann", 3], ["cy", 9], ["dee", 4]]).best());

const walked = new Map([["ann", 1], ["bob", 2], ["cy", 3], ["dee", 4]]);
const alias = walked;
let product = 1;
for (const [name] of walked) product *= walked.get(name)! + (alias.has(name) ? 1 : 0);
console.log("asked while it is walked", product, alias === walked);

const large = new Set(["if", "else", "for", "while", "do", "switch", "case", "break", "continue", "return", "function", "class", "const", "let", "var", "new", "delete", "typeof", "void", "in", "of", "try", "catch", "finally", "throw"]);
const source = "if x of y return z else throw new w in v while u".split(" ");
let keywords = 0;
for (let i = 0; i < 1300; i++) if (large.has(source[i % source.length]!)) keywords++;
console.log("words split out of a line", keywords, large.size);

const lines = [["if", "x", "return", "y"], ["for", "z", "q"], ["else", "while", "if", "w"]];
async function countIn(words: Set<string>, rounds: number): Promise<number> {
  let count = 0;
  for (let round = 0; round < rounds; round++) {
    const line = await Promise.resolve(lines[round % 3]!);
    for (let k = 0; k < line.length; k++) if (words.has(line[k]!)) count++;
  }
  return count;
}
console.log("inside a loop that awaits", await countIn(new Set(["if", "else", "for", "while", "return"]), 3000), await countIn(new Set(nobody), 30), await countIn(large, 300));

function* sums(ranks: Map<string, number>, asked: string[], rounds: number): Generator<number, number, number> {
  let all = 0;
  for (let round = 0; round < rounds; round++) {
    const step = yield all;
    for (let k = 0; k < asked.length; k++) all += (ranks.get(asked[k]!) ?? 0) * step;
  }
  return all;
}
const walker = sums(new Map([["ann", 1], ["bob", 2], ["cy", 3]]), names, 2000);
let step = walker.next(0);
while (!step.done) step = walker.next(2);
console.log("inside a loop that yields", step.value);
