// Records whose fields nothing stores to after the literal that makes them are copied in every way there is: by a literal that begins with a spread and has no type of its own,
// under the type of the record, into an object that is there already, with names added and replaced. The copies are other objects with the same names in the same order, and the sources stay as they were.
const outside: any = JSON.parse('{"words":["alpha","beta","gamma","delta"],"numbers":[1,2.5,-3,4]}');
const words: string[] = outside.words.map((word: any) => String(word));
const numbers: number[] = outside.numbers.map((n: any) => Number(n));
const lines: string[] = [];
function show(label: string, value: any): void {
  lines.push(label + ": " + Object.keys(value).join(",") + " = " + JSON.stringify(value));
}

type Texts = { a: string; b: string; c: string };
type Mixed = { text: string; count: number; flag: boolean; list: string[]; inner: Texts; nothing: null; missing?: string };
function texts(i: number): Texts { return { a: words[i & 3], b: words[(i + 1) & 3], c: words[(i + 2) & 3] }; }
function mixed(i: number): Mixed { return { text: words[i & 3], count: numbers[i & 3], flag: (i & 1) === 0, list: [words[i & 3]], inner: texts(i), nothing: null }; }
function withFunctions(i: number) { return { name: words[i & 3], first() { return this.name + "!"; }, second: () => words[(i + 1) & 3], third: function () { return i; } }; }

const keptTexts: Texts[] = [texts(0), texts(1), texts(2), texts(3)];
const keptMixed: Mixed[] = [mixed(0), mixed(1), mixed(2), mixed(3)];
const keptFunctions = [withFunctions(0), withFunctions(1)];

function copyOfAnything(x: any): any { return { ...x }; }
function copyOfTexts(x: Texts): Texts { return { ...x }; }
function copyOfMixed(x: Mixed): Mixed { return { ...x }; }
function copyUnderParameter<T>(x: T): T { return { ...x }; }
function widened(x: any, more: unknown): any { return { ...x, more }; }
function replaced(x: Texts, b: string): Texts { return { ...x, b }; }
function twice(x: any, y: any): any { return { ...x, ...y }; }
function assigned(x: any): any { return Object.assign({}, x); }
function filled(x: Texts): Texts { const target = {} as Texts; Object.assign(target, x); return target; }

for (let i = 0; i < 4; ++i) {
  const t = keptTexts[i];
  const m = keptMixed[i];
  show("texts, no type " + i, copyOfAnything(t));
  show("texts, typed " + i, copyOfTexts(t));
  show("texts, parameter " + i, copyUnderParameter(t));
  show("texts, widened " + i, widened(t, i));
  show("texts, replaced " + i, replaced(t, "B"));
  show("texts, assigned " + i, assigned(t));
  show("texts, filled " + i, filled(t));
  show("mixed, no type " + i, copyOfAnything(m));
  show("mixed, typed " + i, copyOfMixed(m));
  show("mixed, parameter " + i, copyUnderParameter(m));
  show("mixed, widened " + i, widened(m, t));
  show("both " + i, twice(t, m));
  show("both, the other way " + i, twice(m, t));
  lines.push("other objects " + i + ": " + [copyOfAnything(t) !== t, copyOfTexts(t) !== t, copyOfAnything(m).inner === m.inner, copyOfMixed(m).list === m.list].join(" "));
}
for (const f of keptFunctions) {
  const copy = copyOfAnything(f);
  lines.push("functions: " + Object.keys(copy).join(",") + " " + copy.first() + " " + copy.second() + " " + copy.third() + " " + (copy.first === f.first) + " " + (copy.second === f.second) + " " + (copy.third === f.third));
  const again = copyOfAnything(copy);
  lines.push("functions, a copy of the copy: " + again.first() + " " + (again.third === f.third));
}
// A copy of a copy of a copy, and many of them, so that a collection runs among them.
let chain: any = keptMixed[0];
let total = 0;
for (let i = 0; i < 20000; ++i) {
  chain = copyOfAnything(chain);
  total += chain.count + copyOfAnything(keptTexts[i & 3]).a.length;
}
show("the last of many", chain);
lines.push("total " + total);
for (let i = 0; i < 4; ++i) {
  show("the source of texts " + i, keptTexts[i]);
  show("the source of mixed " + i, keptMixed[i]);
}
console.log(lines.join("\n"));
