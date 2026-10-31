// indexOf and includes with a text and a start, against every kind of start and of array.
function indexOfIn(list: string[], text: string, start: number): number {
  return list.indexOf(text, start);
}
function includesIn(list: string[], text: string, start: number): boolean {
  return list.includes(text, start);
}
function indexOfInValues(list: unknown[], text: string, start: number): number {
  return list.indexOf(text, start);
}
function includesInValues(list: unknown[], text: string, start: number): boolean {
  return list.includes(text, start);
}
function fresh(text: string): string {
  return JSON.parse(JSON.stringify(text));
}

const starts = [0, 1, 2, 3, 4, 5, 6, 100, -1, -2, -3, -6, -100, -0, 0.5, 1.5, 2.999, -0.5, -1.5, NaN, Infinity, -Infinity, 2 ** 31, 2 ** 32, 2 ** 32 + 1, 2 ** 53, 2 ** 62, 2 ** 64, -(2 ** 32), -(2 ** 62), 1e300];

function row(name: string, list: string[], texts: string[]): void {
  for (const text of texts) {
    const answers: unknown[] = [];
    for (const start of starts) answers.push(indexOfIn(list, text, start), includesIn(list, text, start));
    console.log(name, JSON.stringify(text), answers.join(" "));
  }
}
function valuesRow(name: string, list: unknown[], texts: string[]): void {
  for (const text of texts) {
    const answers: unknown[] = [];
    for (const start of starts) answers.push(indexOfInValues(list, text, start), includesInValues(list, text, start));
    console.log(name, JSON.stringify(text), answers.join(" "));
  }
}

row("strings", ["a", "b", "a", "c", "b", "a"], ["a", "b", "c", "d", "", fresh("a"), "aa"]);
row("empty", [], ["a", ""]);
row("one", ["only"], ["only", fresh("only"), "other"]);
row("long", ["a string longer than one word", "another string longer than a word", "a string longer than one word"], [fresh("a string longer than one word"), fresh("another string longer than a word")]);
row("utf16", ["é", "ሴ", "é", "ሴx", "x"], ["é", "ሴ", fresh("ሴx"), "x"]);

const left = fresh("hello ");
const right = fresh("world");
row("ropes", [left + right, "x", left + right, right + left], [left + right, fresh("hello world"), right + left]);
const whole = fresh("the quick brown fox jumps over the lazy dog");
row("parts", [whole.slice(4, 9), whole.slice(10, 15), whole.slice(4, 9), whole.slice(0, 30)], ["quick", "brown", whole.slice(4, 9), whole.slice(0, 30)]);

valuesRow("mixed", [1, "a", undefined, null, "b", {}, "a", true, 2.5], ["a", "b", "undefined", "null", "1", ""]);
valuesRow("holes", ["a", , "b", , , "a"], ["a", "b", "undefined", ""]);
valuesRow("whole numbers", [1, 2, 3], ["1", "a"]);
valuesRow("fractions", [1.5, 2.5, 3.5], ["1.5", "a"]);
valuesRow("nothing yet", [], ["a"]);

const sparse: unknown[] = [];
sparse[0] = "a";
sparse[1000000] = "a";
sparse[1000001] = "b";
for (const start of [0, 1, 1000000, 1000001, 1000002, -1, -2]) console.log("sparse", start, indexOfInValues(sparse, "a", start), indexOfInValues(sparse, "b", start), includesInValues(sparse, "b", start));

const pattern = /^(?:\/a\/([^/]+)()|\/b\/([^/]+)\/([^/]+)()|\/c()|\/d\/([^/]+)())$/;
for (const path of ["/b/x/y", "/a/1", "/d/last", "/c"]) {
  const match = pattern.exec(path)!;
  const answers: unknown[] = [];
  for (const start of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, -1]) answers.push(match.indexOf("", start), match.includes("x", start));
  console.log("match", path, answers.join(" "));
}

class Words extends Array<string> {}
const words = new Words();
words.push("a", "b", "a");
for (const start of [0, 1, 2, 3, -1]) console.log("subclass", start, words.indexOf("a", start), words.includes("b", start));

let reads = 0;
const counted = ["a", "b", "a"];
Object.defineProperty(counted, 1, { get() { reads++; return "a"; }, enumerable: true, configurable: true });
for (const start of [0, 1, 2, 3, -2]) console.log("getter", start, indexOfInValues(counted, "a", start), includesInValues(counted, "a", start), reads);

const frozen = Object.freeze(["a", "b", "a"]) as string[];
for (const start of [0, 1, 2, 3]) console.log("frozen", start, indexOfIn(frozen, "a", start));

const shrunk = ["a", "b", "a", "b"];
shrunk.length = 2;
for (const start of [0, 1, 2, 3, 4]) console.log("shrunk", start, indexOfIn(shrunk, "b", start), includesIn(shrunk, "a", start));

let total = 0;
const hot = ["n0", "n1", "n2", "n3", "n4", "n5", "n6", "n7"];
const asked = hot.map(fresh);
for (let i = 0; i < 100000; i++) total = (total + indexOfIn(hot, asked[i & 7]!, i & 3) + (includesIn(hot, asked[i & 7]!, (i >> 3) & 7) ? 1 : 0)) | 0;
console.log("hot", total);
