// A key that is put together for one lookup, `table.get(a + ":" + b)`, is looked up by its parts and never becomes a string. Every such lookup answers what the lookup of the finished key answers: with parts that are 8-bit, 16-bit, ropes, slices, empty or integers, with keys that entered the table in another form, with keys under, at and over the length that is looked up by parts, and in a Map or a Set whose `get` or `has` is not the built-in one.
// STATISTIC: KeyPartsLookupGroups >= 17
// CALLS+ getOfTwo operationAOTMapGetByKeyParts
// CALLS+ getOfThree operationAOTMapGetByKeyParts
// CALLS+ getOfTemplate operationAOTMapGetByKeyParts
// CALLS+ hasOfTwo operationAOTHasByKeyParts
// CALLS+ hasOfThree operationAOTHasByKeyParts
// CALLS+ listsTwo operationAOTHasByKeyParts
// CALLS+ listsThree operationAOTHasByKeyParts
// CALLS+ getByInteger operationAOTMapGetByKeyParts
// CALLS+ hasByInteger operationAOTHasByKeyParts
// CALLS+ listsInteger operationAOTHasByKeyParts
// CALLS+ getTextThenInteger operationAOTMapGetByKeyParts
// CALLS+ getIntegerThenText operationAOTMapGetByKeyParts
// CALLS+ getByTwoIntegers operationAOTMapGetByKeyParts
// CALLS+ getOfEight operationAOTMapGetByKeyParts
// CALLS+ listsEight operationAOTHasByKeyParts
// CALLS+ findItem operationAOTMapGetByKeyParts
// CALLS+ findText operationAOTMapGetByKeyParts
// CALLS- getOfNine ByKeyParts
// CALLS- getByNumber ByKeyParts
// CALLS- getByAnything ByKeyParts
// CALLS- getOfKeptKey ByKeyParts
// CALLS- storeUnder ByKeyParts
// CALLS- addUnder ByKeyParts
type Table = Map<string, number>;
type Names = Set<string>;
type Form = (text: string) => string;
interface Item { name: string }

export function getOfTwo(table: Table, a: string, b: string): number | undefined { return table.get(a + b); }
export function getOfThree(table: Table, a: string, b: string): number | undefined { return table.get(a + ":" + b); }
export function getOfTemplate(table: Table, a: string, b: string): number | undefined { return table.get(`${a}:${b}`); }
export function hasOfTwo(table: Table, a: string, b: string): boolean { return table.has(a + b); }
export function hasOfThree(table: Table, a: string, b: string): boolean { return table.has(a + ":" + b); }
export function listsTwo(names: Names, a: string, b: string): boolean { return names.has(a + b); }
export function listsThree(names: Names, a: string, b: string): boolean { return names.has(a + ":" + b); }
export function getByInteger(table: Table, a: string, n: number): number | undefined { return table.get(a + "#" + (n | 0)); }
export function hasByInteger(table: Table, a: string, n: number): boolean { return table.has(a + "#" + (n | 0)); }
export function listsInteger(names: Names, a: string, n: number): boolean { return names.has(a + "#" + (n | 0)); }
export function getTextThenInteger(table: Table, a: string, n: number): number | undefined { return table.get(a + (n | 0)); }
export function getIntegerThenText(table: Table, n: number, a: string): number | undefined { return table.get((n | 0) + a); }
export function getByTwoIntegers(table: Table, m: number, n: number): number | undefined { return table.get(`${m | 0}${n | 0}`); }
export function getOfEight(table: Table, a: string, b: string, c: string, m: number, n: number): number | undefined { return table.get(a + "/" + b + "/" + (m | 0) + "/" + c + (n | 0)); }
export function listsEight(names: Names, a: string, b: string, c: string, m: number, n: number): boolean { return names.has(a + "/" + b + "/" + (m | 0) + "/" + c + (n | 0)); }
export function findItem(items: Map<string, Item>, a: string, b: string): Item | undefined { return items.get(a + ":" + b); }
export function findText(notes: Map<string, string | undefined>, a: string, b: string): string | undefined { return notes.get(a + ":" + b); }
// These make their key: it has too many parts, a part prints in more ways than a string or an int32 does, or the string is needed again.
export function getOfNine(table: Table, a: string, b: string, c: string, m: number, n: number): number | undefined { return table.get(a + "/" + b + "/" + (m | 0) + "/" + c + "/" + (n | 0)); }
export function getByNumber(table: Table, a: string, n: number): number | undefined { return table.get(a + "#" + n); }
export function getByAnything(table: Table, a: any, b: string): number | undefined { return table.get(a + b); }
export function getOfKeptKey(table: Table, a: string, b: string): number | undefined { const key = a + ":" + b; return table.has(key) ? table.get(key) : undefined; }
export function storeUnder(table: Table, a: string, b: string, value: number): Table { return table.set(a + ":" + b, value); }
export function addUnder(names: Names, a: string, b: string): Names { return names.add(a + ":" + b); }
// The same lookups once more. These are also handed subclasses, Maps and Sets with a `get` or `has` of their own, and arguments of other types than they declare.
export function getFromAnyMap(table: Table, a: string, b: string): number | undefined { return table.get(a + ":" + b); }
export function getTemplateFromAnyMap(table: Table, a: string, b: string): number | undefined { return table.get(`${a}:${b}`); }
export function getTwoFromAnyMap(table: Table, a: string, b: string): number | undefined { return table.get(a + b); }
export function getIntegerFromAnyMap(table: Table, a: string, n: number): number | undefined { return table.get(a + "#" + (n | 0)); }
export function getEightFromAnyMap(table: Table, a: string, b: string, c: string, m: number, n: number): number | undefined { return table.get(a + "/" + b + "/" + (m | 0) + "/" + c + (n | 0)); }
export function anyMapHas(table: Table, a: string, b: string): boolean { return table.has(a + ":" + b); }
export function anyMapHasTwo(table: Table, a: string, b: string): boolean { return table.has(a + b); }
export function anySetHas(names: Names, a: string, b: string): boolean { return names.has(a + ":" + b); }
export function anySetHasTwo(names: Names, a: string, b: string): boolean { return names.has(a + b); }
export function anySetHasInteger(names: Names, a: string, n: number): boolean { return names.has(a + "#" + (n | 0)); }
function getWhole(table: Table, key: string): number | undefined { return table.get(key); }

// These two call a method of what they are handed, which is often a sum of two array reads: NaN, if both reads are past the end. A method call on a number finds whatever a program
// may have put on Number.prototype, and then nothing is known of the answer. So the receiver is made a string for certain: this program is about the lookups.
// strings/lookups-behind-a-helper-that-is-handed-a-sum-of-array-reads is about the helpers.
function flat(text: string): string { return ("" + text).split("").join(""); }
function rope(text: string): string { const whole = "" + text, middle = whole.length >> 1; return whole.slice(0, middle) + whole.slice(middle); }
function sliced(text: string): string { return ("<" + text + ">").slice(1, 1 + text.length); }
// 16-bit characters, also where all of them fit 8 bits.
function wide(text: string): string { return ("Ж" + text).slice(1); }
const forms: [string, Form][] = [["flat", flat], ["rope", rope], ["slice", sliced], ["wide", wide]];

const wrong: string[] = [];
let found = 0, missed = 0, sum = 0;
function show(text: string): string {
  let shown = "";
  for (let i = 0; i < text.length && i < 12; i++) {
    const unit = text.charCodeAt(i);
    shown += unit >= 32 && unit < 127 ? text[i] : "\\u" + (unit + 0x10000).toString(16).slice(1);
  }
  return '"' + shown + '"' + (text.length > 12 ? "(" + text.length + ")" : "");
}
function expectSame(what: string, answer: number | boolean | undefined, wanted: number | boolean | undefined, a: string, b: string): void {
  if (answer === undefined || answer === false) missed++;
  else {
    found++;
    if (answer !== true) sum = (sum * 31 + answer) % 1000003;
  }
  if (answer !== wanted && wrong.length < 20) wrong.push(what + " " + show(a) + " " + show(b) + ": " + String(answer) + ", not " + String(wanted));
}
function report(title: string): void {
  console.log(title + ": " + found + " found, " + missed + " not, sum " + sum);
  found = missed = sum = 0;
}

const texts = ["", "a", "b", ":", "ab", "a:b", "b:", "-", "-0", "0", "1", "2", "12", "00", "é", "ÿ", "Ā", "Ж", "日本", "\u{1F600}", "undefined"];
const size = texts.length;
for (const [keyForm, makeKey] of forms) {
  const table: Table = new Map(), names: Names = new Set();
  let next = 1;
  for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) {
    if ((i * 7 + j * 3) % 4 !== 0) { const key = makeKey(texts[i] + ":" + texts[j]); table.set(key, next++); names.add(key); }
    if ((i + j * 5) % 3 === 0) { const key = makeKey(texts[i] + texts[j]); table.set(key, next++); names.add(key); }
  }
  const wantedOfTwo: (number | undefined)[] = [], wantedOfThree: (number | undefined)[] = [];
  for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) {
    wantedOfTwo.push(getWhole(table, flat(texts[i] + texts[j])));
    wantedOfThree.push(getWhole(table, flat(texts[i] + ":" + texts[j])));
  }
  for (const [leftForm, left] of forms) for (const [rightForm, right] of forms) {
    for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) {
      const a = texts[i], b = texts[j], two = wantedOfTwo[i * size + j], three = wantedOfThree[i * size + j];
      expectSame("getOfTwo", getOfTwo(table, left(a), right(b)), two, a, b);
      expectSame("getOfThree", getOfThree(table, left(a), right(b)), three, a, b);
      expectSame("getOfTemplate", getOfTemplate(table, left(a), right(b)), three, a, b);
      expectSame("hasOfTwo", hasOfTwo(table, left(a), right(b)), two !== undefined, a, b);
      expectSame("hasOfThree", hasOfThree(table, left(a), right(b)), three !== undefined, a, b);
      expectSame("listsTwo", listsTwo(names, left(a), right(b)), two !== undefined, a, b);
      expectSame("listsThree", listsThree(names, left(a), right(b)), three !== undefined, a, b);
      expectSame("getOfKeptKey", getOfKeptKey(table, left(a), right(b)), three, a, b);
      expectSame("getFromAnyMap", getFromAnyMap(table, left(a), right(b)), three, a, b);
      expectSame("getTemplateFromAnyMap", getTemplateFromAnyMap(table, left(a), right(b)), three, a, b);
      expectSame("getTwoFromAnyMap", getTwoFromAnyMap(table, left(a), right(b)), two, a, b);
      expectSame("anyMapHas", anyMapHas(table, left(a), right(b)), three !== undefined, a, b);
      expectSame("anyMapHasTwo", anyMapHasTwo(table, left(a), right(b)), two !== undefined, a, b);
      expectSame("anySetHas", anySetHas(names, left(a), right(b)), three !== undefined, a, b);
      expectSame("anySetHasTwo", anySetHasTwo(names, left(a), right(b)), two !== undefined, a, b);
    }
    report("keys " + keyForm + ", parts " + leftForm + " and " + rightForm);
  }
}

// "1" + "2", "" + 12 and "1" + 2 are the string "12", never the number 12; "-" + 0 is "-0".
const integers = [0, -0, 1, -1, 2, 7, 10, 12, -12, 99, 3647, 67294, 65535, 2147483647, -2147483648, 2147483648, 4294967295, 1.9, -1.9, NaN, Infinity];
const heads = ["", "a", "-", "--", "0", "1", "12", "214748", "42949", "#", "é", "Ж", "x".repeat(40)];
for (const hasNumbers of [false, true]) for (const hasTexts of [true, false]) {
  const table: Table = new Map(), names: Names = new Set();
  if (hasNumbers) for (const n of [0, 1, 12, 112, 1212, -1, 2147483647, 4294967294]) { (table as Map<unknown, number>).set(n, -1000 - n); (names as Set<unknown>).add(n); }
  let next = 1;
  if (hasTexts) {
    for (let h = 0; h < heads.length; h++) for (let k = 0; k < integers.length; k++) {
      if ((h + k) % 3 === 0) continue;
      const digits = String(integers[k] | 0);
      for (const text of [heads[h] + "#" + digits, heads[h] + digits, digits + heads[h], heads[h] + "#" + String(integers[k])]) { const key = flat(text); table.set(key, next++); names.add(key); }
    }
    for (let m = 0; m < integers.length; m++) for (let n = 0; n < integers.length; n++) if ((m + n) % 2) table.set(flat(String(integers[m] | 0) + String(integers[n] | 0)), next++);
  }
  for (const [form, make] of forms) {
    for (const head of heads) for (const n of integers) {
      const digits = String(n | 0), behindHash = getWhole(table, flat(head + "#" + digits));
      expectSame("getByInteger", getByInteger(table, make(head), n), behindHash, head, digits);
      expectSame("hasByInteger", hasByInteger(table, make(head), n), behindHash !== undefined, head, digits);
      expectSame("listsInteger", listsInteger(names, make(head), n), behindHash !== undefined, head, digits);
      expectSame("getTextThenInteger", getTextThenInteger(table, make(head), n), getWhole(table, flat(head + digits)), head, digits);
      expectSame("getIntegerThenText", getIntegerThenText(table, n, make(head)), getWhole(table, flat(digits + head)), digits, head);
      expectSame("getByNumber", getByNumber(table, make(head), n), getWhole(table, flat(head + "#" + String(n))), head, String(n));
      expectSame("getIntegerFromAnyMap", getIntegerFromAnyMap(table, make(head), n), behindHash, head, digits);
      expectSame("anySetHasInteger", anySetHasInteger(names, make(head), n), behindHash !== undefined, head, digits);
    }
    report("integers, " + (hasTexts ? "texts" : "no texts") + (hasNumbers ? " and numbers" : "") + " as keys, parts " + form);
  }
  for (const m of integers) for (const n of integers) expectSame("getByTwoIntegers", getByTwoIntegers(table, m, n), getWhole(table, flat(String(m | 0) + String(n | 0))), String(m), String(n));
  report("two integers, " + (hasTexts ? "texts" : "no texts") + (hasNumbers ? " and numbers" : "") + " as keys");
}

function cutsOf(total: number): number[] { return [0, 1, total >> 1, total - 2, total - 1]; }
function startingOtherwise(text: string): string { return "z" + text.slice(1); }
const tails = [0, 7, -7, 12345, 2147483647, -2147483648];
for (const letter of ["x", "é", "Ж"]) {
  const table: Table = new Map(), names: Names = new Set();
  let next = 1;
  for (let total = 48; total <= 80; total++) for (const cut of cutsOf(total)) {
    if ((total + cut) % 3 === 0) continue;
    const key = flat(letter.repeat(cut) + ":" + "y".repeat(total - 1 - cut));
    table.set(key, next++); names.add(key);
  }
  for (let length = 40; length <= 68; length++) for (let t = 0; t < tails.length; t++) {
    if ((length + t) % 3 === 0) continue;
    const key = flat(letter.repeat(length) + "#" + String(tails[t]));
    table.set(key, next++); names.add(key);
  }
  for (const [form, make] of forms) {
    for (let total = 48; total <= 80; total++) for (const cut of cutsOf(total)) {
      const a = letter.repeat(cut), b = "y".repeat(total - 1 - cut), wanted = getWhole(table, flat(a + ":" + b));
      expectSame("getOfThree", getOfThree(table, make(a), make(b)), wanted, a, b);
      expectSame("getOfTemplate", getOfTemplate(table, make(a), make(b)), wanted, a, b);
      expectSame("hasOfThree", hasOfThree(table, make(a), make(b)), wanted !== undefined, a, b);
      expectSame("listsThree", listsThree(names, make(a), make(b)), wanted !== undefined, a, b);
      expectSame("getOfTwo", getOfTwo(table, make(a + ":"), make(b)), wanted, a, b);
      expectSame("listsTwo", listsTwo(names, make(a), make(":" + b)), wanted !== undefined, a, b);
      const c = cut ? startingOtherwise(a) : a, d = cut ? b : startingOtherwise(b);
      expectSame("getOfThree", getOfThree(table, make(c), make(d)), undefined, c, d);
      expectSame("listsThree", listsThree(names, make(c), make(d)), false, c, d);
    }
    report("keys of 48 to 80 characters that start with " + show(letter) + ", parts " + form);
    for (let length = 40; length <= 68; length++) for (const n of tails) {
      const head = letter.repeat(length), wanted = getWhole(table, flat(head + "#" + String(n)));
      expectSame("getByInteger", getByInteger(table, make(head), n), wanted, head, String(n));
      expectSame("hasByInteger", hasByInteger(table, make(head), n), wanted !== undefined, head, String(n));
      expectSame("listsInteger", listsInteger(names, make(head), n), wanted !== undefined, head, String(n));
      expectSame("getTextThenInteger", getTextThenInteger(table, make(head + "#"), n), wanted, head, String(n));
    }
    report("an integer behind 40 to 68 times " + show(letter) + ", parts " + form);
  }
}
{
  const table: Table = new Map();
  for (const length of [128, 1000, 70000]) table.set(flat("p".repeat(length) + ":" + "q".repeat(length)), length);
  for (const [form, make] of forms) {
    for (const length of [128, 1000, 70000]) {
      const a = "p".repeat(length), b = "q".repeat(length);
      expectSame("getOfThree", getOfThree(table, make(a), make(b)), length, a, b);
      expectSame("hasOfThree", hasOfThree(table, make(b), make(a)), false, b, a);
    }
    report("long keys, parts " + form);
  }
}

{
  const table: Table = new Map(), names: Names = new Set(), few = ["", "a", "é", "Ж"], counts = [0, -1, 12, -2147483648];
  let next = 1;
  for (const a of few) for (const b of few) for (const c of few) for (const m of counts) for (const n of counts) {
    if (next++ % 3 === 0) continue;
    for (const text of [a + "/" + b + "/" + m + "/" + c + n, a + "/" + b + "/" + m + "/" + c + "/" + n]) { const key = flat(text); table.set(key, next); names.add(key); }
  }
  let turn = 0;
  for (const a of few) for (const b of few) for (const c of few) for (const m of counts) for (const n of counts) {
    const makeA = forms[turn % 4][1], makeB = forms[(turn >> 2) % 4][1], makeC = forms[(turn >> 4) % 4][1], wanted = getWhole(table, flat(a + "/" + b + "/" + m + "/" + c + n));
    turn++;
    expectSame("getOfEight", getOfEight(table, makeA(a), makeB(b), makeC(c), m, n), wanted, a + b + c, m + " " + n);
    expectSame("listsEight", listsEight(names, makeA(a), makeB(b), makeC(c), m, n), wanted !== undefined, a + b + c, m + " " + n);
    expectSame("getEightFromAnyMap", getEightFromAnyMap(table, makeA(a), makeB(b), makeC(c), m, n), wanted, a + b + c, m + " " + n);
    expectSame("getOfNine", getOfNine(table, makeA(a), makeB(b), makeC(c), m, n), getWhole(table, flat(a + "/" + b + "/" + m + "/" + c + "/" + n)), a + b + c, m + " " + n);
  }
  report("eight parts and nine");
}

const never: Table = new Map(), neverNames: Names = new Set();
const cleared: Table = new Map([["a:b", 1], ["ab", 2]]), clearedNames: Names = new Set(["a:b", "ab"]);
cleared.clear(); clearedNames.clear();
for (const [table, names] of [[never, neverNames], [cleared, clearedNames]] as [Table, Names][]) for (const a of texts) {
  expectSame("getOfTwo", getOfTwo(table, a, "b"), undefined, a, "b");
  expectSame("getOfThree", getOfThree(table, a, "b"), undefined, a, "b");
  expectSame("hasOfThree", hasOfThree(table, a, "b"), false, a, "b");
  expectSame("listsTwo", listsTwo(names, a, "b"), false, a, "b");
  expectSame("getByInteger", getByInteger(table, a, 1), undefined, a, "1");
}
report("a Map and a Set that never held anything, and ones that were cleared");

{
  const table: Table = new Map(), names: Names = new Set();
  for (let i = 0; i < 300; i++) { const key = flat("k" + i + ":v" + (i % 7)); table.set(key, i); names.add(key); }
  for (let i = 0; i < 300; i += 2) { const key = flat("k" + i + ":v" + (i % 7)); table.delete(key); names.delete(key); }
  for (let i = 0; i < 300; i++) {
    expectSame("getOfThree", getOfThree(table, "k" + i, "v" + (i % 7)), i % 2 ? i : undefined, "k" + i, "v");
    expectSame("listsThree", listsThree(names, "k" + i, "v" + (i % 7)), i % 2 === 1, "k" + i, "v");
  }
  report("every other key deleted");
}
{
  const table: Table = new Map(), names: Names = new Set();
  for (let i = 0; i < 30000; i++) { const key = flat("k" + (i % 173) + "#" + i); table.set(key, i); names.add(key); }
  for (let i = 0; i < 60000; i++) {
    expectSame("getByInteger", getByInteger(table, "k" + (i % 173), i), i < 30000 ? i : undefined, "k", String(i));
    expectSame("listsInteger", listsInteger(names, "k" + (i % 173), i), i < 30000, "k", String(i));
  }
  report("30000 keys");
}
{
  const table: Table = new Map(), names: Names = new Set();
  for (let i = 0; i < 2000; i++) {
    expectSame("getOfThree", getOfThree(table, "g" + i, "x"), undefined, "g" + i, "x");
    expectSame("listsThree", listsThree(names, "g" + i, "x"), false, "g" + i, "x");
    storeUnder(table, "g" + i, "x", i); addUnder(names, "g" + i, "x");
    expectSame("getOfThree", getOfThree(table, "g" + i, "x"), i, "g" + i, "x");
    expectSame("listsThree", listsThree(names, "g" + i, "x"), true, "g" + i, "x");
    expectSame("getOfThree", getOfThree(table, "g" + (i >> 1), "x"), i >> 1, "g" + (i >> 1), "x");
  }
  report("looked up while it grows");
}

const constantTable = new Map<string, number>([["a:b", 1], ["ab", 2], [":", 3], ["", 4], ["12", 5], ["a#-1", 6], ["é:ÿ", 7], ["Ж:日本", 8], ["x/y/3/z4", 9], ["-0", 10], ["b:", 11]]);
const constantNames = new Set<string>(["a:b", "ab", ":", "", "12", "a#-1", "é:ÿ", "Ж:日本", "x/y/3/z4", "-0", "b:"]);
for (const [form, make] of forms) {
  for (const a of texts) for (const b of texts) {
    const two = getWhole(constantTable, flat(a + b)), three = getWhole(constantTable, flat(a + ":" + b));
    expectSame("getOfTwo", getOfTwo(constantTable, make(a), make(b)), two, a, b);
    expectSame("getOfThree", getOfThree(constantTable, make(a), make(b)), three, a, b);
    expectSame("hasOfTwo", hasOfTwo(constantTable, make(a), make(b)), two !== undefined, a, b);
    expectSame("listsTwo", listsTwo(constantNames, make(a), make(b)), two !== undefined, a, b);
    expectSame("listsThree", listsThree(constantNames, make(a), make(b)), three !== undefined, a, b);
  }
  expectSame("getByInteger", getByInteger(constantTable, make("a"), -1), 6, "a", "-1");
  expectSame("getTextThenInteger", getTextThenInteger(constantTable, make("-"), 0), 10, "-", "0");
  expectSame("getByTwoIntegers", getByTwoIntegers(constantTable, 1, 2), 5, "1", "2");
  expectSame("getOfEight", getOfEight(constantTable, make("x"), make("y"), make("z"), 3, 4), 9, "xyz", "3 4");
  expectSame("listsEight", listsEight(constantNames, make("x"), make("y"), make("z"), 3, 5), false, "xyz", "3 5");
  report("a Map and a Set of constants, parts " + form);
}

const asked: string[] = [];
function told(title: string, answer: unknown): void {
  console.log(title + ": " + String(answer) + (asked.length ? " after " + asked.join(", ") : ""));
  asked.length = 0;
}
function attempt(title: string, run: () => unknown): void {
  let answer: unknown;
  try { answer = run(); } catch (error) { answer = "throws " + (error as Error).name; }
  told(title, answer);
}

const first: Item = { name: "first" }, second: Item = { name: "second" };
const items = new Map<string, Item>([["a:b", first]]);
items.set(wide("c:d"), second);
told("an object", findItem(items, "a", "b") === first);
told("an object under a 16-bit key", findItem(items, sliced("c"), "d")?.name);
told("no object", findItem(items, "a", "d"));
const notes = new Map<string, string | undefined>([["a:b", "text"], ["a:c", undefined], ["a:d", ""]]);
told("a text, undefined that is stored, an empty text, nothing", [findText(notes, "a", "b"), findText(notes, "a", "c"), findText(notes, "a", "d"), findText(notes, "a", "e")].map(String).join("|"));

class Recording extends Map<string, number> {
  get(key: string): number | undefined { asked.push("get " + key); return super.get(key); }
  has(key: string): boolean { asked.push("has " + key); return super.has(key); }
}
class Inheriting extends Map<string, number> {
  find(a: string, b: string): number | undefined { return this.get(a + ":" + b); }
  findInBase(a: string, b: string): number | undefined { return super.get(a + ":" + b); }
  knows(a: string, n: number): boolean { return super.has(a + ":" + (n | 0)); }
}
class RecordingNames extends Set<string> {
  has(key: string): boolean { asked.push("has " + key); return super.has(key); }
}
const recording = new Recording([["a:b", 1], ["ab", 2]]);
told("a subclass with its own get", getFromAnyMap(recording, "a", "b"));
told("a subclass with its own get, a template", getTemplateFromAnyMap(recording, "a", "c"));
told("a subclass with its own get, an integer", getIntegerFromAnyMap(recording, "a", 7.5));
told("a subclass with its own has", anyMapHasTwo(recording, rope("a"), wide("b")));
const inheriting = new Inheriting([["a:b", 3], ["a:4", 4]]);
told("a subclass that inherits get", getFromAnyMap(inheriting, "a", "b"));
told("a subclass that inherits has", anyMapHas(inheriting, "a", "c"));
told("in methods of the subclass", [inheriting.find("a", "b"), inheriting.findInBase("a", "b"), inheriting.findInBase("b", "a"), inheriting.knows("a", 4), inheriting.knows("a", 5)].join());
const recordingNames = new RecordingNames(["a:b", "a#1"]);
told("a subclass of Set with its own has", anySetHas(recordingNames, "a", "b"));
told("a subclass of Set with its own has, an integer", anySetHasInteger(recordingNames, "a", 2));

const replaced: Table = new Map([["a:b", 4]]);
told("before get is replaced", getFromAnyMap(replaced, "a", "b"));
replaced.get = function (key: string): number | undefined { asked.push("own get " + key); return -4; };
replaced.has = (key: string): boolean => { asked.push("own has " + key); return false; };
told("an own get", getFromAnyMap(replaced, "a", "b"));
told("an own get, two parts", getTwoFromAnyMap(replaced, "", ""));
told("an own get, eight parts", getEightFromAnyMap(replaced, "a", "b", "c", 1, -2));
told("an own has", anyMapHas(replaced, "a", "b"));
delete (replaced as any).get;
delete (replaced as any).has;
told("the own get and has are deleted", getFromAnyMap(replaced, "a", "b") + " " + anyMapHas(replaced, "a", "b"));
const replacedNames: Names = new Set(["a:b"]);
replacedNames.has = (key: string): boolean => { asked.push("own has " + key); return key.length > 3; };
told("an own has of a Set", anySetHas(replacedNames, "a", "b") + " " + anySetHas(replacedNames, "a", "bc"));
const adopted: Table = new Map([["a:b", 5]]);
Object.setPrototypeOf(adopted, { __proto__: Map.prototype, get(key: string): number { asked.push("adopted get " + key); return -5; } });
told("a Map under another prototype", getFromAnyMap(adopted, "a", "b") + " " + anyMapHas(adopted, "a", "b"));
const lookAlike = {
  get(key: string): number { asked.push("get " + key); return key.length; },
  has(key: string): boolean { asked.push("has " + key); return key.length > 2; },
};
told("no Map", getFromAnyMap(lookAlike as unknown as Table, "a", "b") + " " + anyMapHasTwo(lookAlike as unknown as Table, "a", "b") + " " + getIntegerFromAnyMap(lookAlike as unknown as Table, "a", -1));
told("no Set", anySetHas(lookAlike as unknown as Names, "a", "b"));
attempt("a Set for the Map", () => getFromAnyMap(new Set(["a:b"]) as unknown as Table, "a", "b"));
attempt("a Map for the Set", () => anySetHas(new Map([["a:b", 1]]) as unknown as Names, "a", "b"));
attempt("undefined for the Map", () => getFromAnyMap(undefined as unknown as Table, "a", "b"));

function noted(tag: string, text: string): string { asked.push(tag); return text; }
export function getOfNotedParts(table: Table, a: string, b: string): number | undefined { return table.get(noted("first", a) + ":" + noted("second", b)); }
told("the parts are computed in order", getOfNotedParts(constantTable, "a", "b"));

const odd: Table = new Map([["1:null", 1], ["undefined:1.5", 2], ["T:true", 3], ["a#0", 4], ["a#1", 5], ["V:b", 6], ["Vb", 7], ["1.5b", 8]]);
const texty = { toString(): string { asked.push("toString"); return "T"; } };
const valued = { valueOf(): string { asked.push("valueOf"); return "V"; }, toString(): string { asked.push("toString"); return "T"; } };
attempt("a number and null for the texts", () => getFromAnyMap(odd, 1 as any, null as any));
attempt("undefined and a fraction for the texts", () => getFromAnyMap(odd, undefined as any, 1.5 as any));
attempt("an object and true for the texts", () => getFromAnyMap(odd, texty as any, true as any));
attempt("an object and true for the texts, a template", () => getTemplateFromAnyMap(odd, texty as any, true as any));
attempt("an object with valueOf for a text", () => getFromAnyMap(odd, valued as any, "b"));
attempt("an object with valueOf for a text, a template", () => getTemplateFromAnyMap(odd, valued as any, "b"));
attempt("an object with valueOf for anything", () => getByAnything(odd, valued, "b"));
attempt("a fraction for anything", () => getByAnything(odd, 1.5, "b"));
attempt("a text for anything", () => getByAnything(odd, "V:", "b"));
attempt("a symbol for a text", () => getFromAnyMap(odd, Symbol("s") as any, "b"));
attempt("a symbol for a text, in a Set", () => anySetHasTwo(constantNames, "a", Symbol("s") as any));
attempt("a text for the integer", () => getIntegerFromAnyMap(odd, "a", "1" as any));
attempt("an object for the integer", () => getIntegerFromAnyMap(odd, "a", { valueOf(): number { asked.push("valueOf"); return 1.7; } } as any));
attempt("undefined for the integer", () => getIntegerFromAnyMap(odd, "a", undefined as any));
attempt("a bigint for the integer", () => getIntegerFromAnyMap(odd, "a", 1n as any));

// 2 ** 30 characters as a rope. Twice as many are more than a string holds, and the concatenation throws whatever the table holds.
let big = "x";
for (let i = 0; i < 30; i++) big = big + big;
attempt("a key that is too long, in a Map that never held anything", () => getOfTwo(never, big, big));
attempt("a key that is too long, in a Map", () => getOfThree(odd, big, big));
attempt("a key that is too long, asked of a Map", () => hasOfTwo(constantTable, big, big));
attempt("a key that is too long, asked of a Set that never held anything", () => listsTwo(neverNames, big, big));
attempt("a key that is too long, asked of a Set", () => listsThree(constantNames, big, big));

console.log("wrong: " + wrong.join("; "));
(globalThis as any).kept = [getOfTwo, getOfThree, getOfTemplate, hasOfTwo, hasOfThree, listsTwo, listsThree, getByInteger, hasByInteger, listsInteger, getTextThenInteger, getIntegerThenText, getByTwoIntegers, getOfEight, listsEight, findItem, findText, getOfNine, getByNumber, getByAnything, getOfKeptKey, storeUnder, addUnder, getOfNotedParts, getFromAnyMap, getTemplateFromAnyMap, getTwoFromAnyMap, getIntegerFromAnyMap, getEightFromAnyMap, anyMapHas, anyMapHasTwo, anySetHas, anySetHasTwo, anySetHasInteger];
