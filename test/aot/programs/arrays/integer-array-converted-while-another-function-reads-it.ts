// An array of a numeric enum, or of a union of small integers, is stored as 32-bit integers, and typed code that reads it as `Kind[]` counts on that. A function that takes the same array as `number[]` counts on doubles, and may turn the storage into doubles the first time it meets the integers. Here that happens while another function is in the middle of the array: in a loop that reads, switches, indexes a table, stores, pushes, pops or searches, between two reads, in a callback, a pattern, a generator, an async function, a recursion, through a second name for the same array. The callee is called by name (small enough to be inlined, or not), through another function, as a function value, a getter. Nothing of it can be seen: every result is plain Bun's.
// STATISTIC: IntegerArrayConversionsPlaced >= 1
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function list(a: unknown[]): string {
  let text = "[";
  for (let i = 0; i < a.length; i++) text += (i > 0 ? " " : "") + (i in a ? show(a[i]) : "hole");
  return text + "]";
}

function outcome<T>(a: T[], run: (a: T[]) => unknown): string {
  let text: string;
  try {
    text = String(run(a));
  } catch (error) {
    text = "threw " + (error as Error).constructor.name;
  }
  return text + " " + list(a);
}

enum Kind { Space, Word, Digit, Mark }
type Bit = 0 | 1;
type Level = 1 | 2 | 3;
const kindNames = ["space", "word", "digit", "mark"];

// The functions that take the array as `number[]`.
function total(values: number[]): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  return sum;
}

let depth = 0;
function totalApart(values: number[]): number {
  if (depth > 0) {
    depth--;
    return totalApart(values);
  }
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  return sum;
}

function totalOfApart(values: number[]): number {
  if (depth > 0) {
    depth--;
    return totalOfApart(values);
  }
  let sum = 0;
  for (const value of values) sum += value;
  return sum;
}

function throughAnother(values: number[]): number {
  return totalApart(values) + 1;
}

function firstOf(values: number[]): number {
  return values[0];
}

function halvesTheSecond(values: number[]): number {
  values[1] = values[1] / 2;
  return values[1];
}

function pushesAFraction(values: number[]): number {
  return values.push(0.5);
}

function storesNaN(values: number[]): number {
  values[1] = values[1] / 0 - values[1] / 0;
  return totalApart(values);
}

function storesTheSame(values: number[]): number {
  for (let i = 0; i < values.length; i++) values[i] = values[i] + 0;
  return values.length;
}

// They also get arrays that the compiler knows nothing about.
console.log(total(JSON.parse("[0.5,1.5]") as number[]) + " " + totalApart(JSON.parse("[0.5,2.5]") as number[]) + " " + totalOfApart(JSON.parse("[0.5,3.5]") as number[]) + " " + throughAnother(JSON.parse("[1,2]") as number[]) + " " + firstOf(JSON.parse("[4.5]") as number[]));

// The functions that are in the middle of the array as `Kind[]`.
function countsAroundSmallCall(kinds: Kind[], when: number): string {
  let words = 0, code = 0;
  for (let i = 0; i < kinds.length; i++) {
    if (i === when) code += total(kinds);
    if (kinds[i] === Kind.Word) words++;
    code = (code * 5 + kinds[i]) | 0;
  }
  return words + " " + code;
}

function countsAroundCall(kinds: Kind[], when: number): string {
  let words = 0, code = 0;
  for (let i = 0; i < kinds.length; i++) {
    if (i === when) code += totalApart(kinds);
    if (kinds[i] === Kind.Word) words++;
    code = (code * 5 + kinds[i]) | 0;
  }
  return words + " " + code;
}

function countsAroundForOfCall(kinds: Kind[], when: number): string {
  let words = 0, code = 0;
  for (let i = 0; i < kinds.length; i++) {
    if (i === when) code += totalOfApart(kinds);
    if (kinds[i] === Kind.Word) words++;
    code = (code * 5 + kinds[i]) | 0;
  }
  return words + " " + code;
}

function countsAroundDeeperCall(kinds: Kind[], when: number): string {
  let words = 0, code = 0;
  for (let i = 0; i < kinds.length; i++) {
    if (i === when) code += throughAnother(kinds);
    if (kinds[i] === Kind.Word) words++;
    code = (code * 5 + kinds[i]) | 0;
  }
  return words + " " + code;
}

function countsAroundOneRead(kinds: Kind[], when: number): string {
  let words = 0, code = 0;
  for (let i = 0; i < kinds.length; i++) {
    if (i === when) code += firstOf(kinds);
    if (kinds[i] === Kind.Word) words++;
    code = (code * 5 + kinds[i]) | 0;
  }
  return words + " " + code;
}

function countsWithACallEachTime(kinds: Kind[], when: number): string {
  let code = when;
  for (let i = 0; i < kinds.length; i++) code = (code * 5 + kinds[i] + totalApart(kinds)) | 0;
  return String(code);
}

function addsAroundCall(kinds: Kind[], when: number): string {
  let sum = 0;
  for (let i = 0; i < kinds.length; i++) {
    if (i === when) sum += totalApart(kinds) * 100;
    sum += kinds[i];
  }
  return String(sum);
}

function switchesAroundCall(kinds: Kind[], when: number): string {
  let text = "";
  for (let i = 0; i < kinds.length; i++) {
    if (i === when) totalApart(kinds);
    switch (kinds[i]) {
      case Kind.Space: text += "_"; break;
      case Kind.Word: text += "w"; break;
      case Kind.Digit: text += "d"; break;
      case Kind.Mark: text += "!"; break;
      default: text += "?";
    }
  }
  return text;
}

function namesAroundCall(kinds: Kind[], when: number): string {
  let text = "";
  for (let i = 0; i < kinds.length; i++) {
    if (i === when) totalApart(kinds);
    text += kindNames[kinds[i]] + " ";
  }
  return text;
}

function masksAroundCall(kinds: Kind[], when: number): string {
  let mask = 0, shifted = 0;
  for (let i = 0; i < kinds.length; i++) {
    if (i === when) totalApart(kinds);
    mask |= 1 << kinds[i];
    shifted = (shifted << 2) | kinds[i];
  }
  return mask + " " + shifted;
}

function textAroundCall(kinds: Kind[], when: number): string {
  let text = "";
  for (let i = 0; i < kinds.length; i++) {
    if (i === when) totalApart(kinds);
    text += kinds[i];
  }
  return text;
}

function forOfAroundCall(kinds: Kind[], when: number): string {
  let text = "", code = 0, i = 0;
  for (const kind of kinds) {
    if (i++ === when) totalApart(kinds);
    text += kind;
    code = (code * 5 + kind) | 0;
  }
  return text + " " + code;
}

function backwardsAroundCall(kinds: Kind[], when: number): string {
  let code = 0;
  for (let i = kinds.length - 1; i >= 0; i--) {
    if (i === when) totalApart(kinds);
    code = (code * 5 + kinds[i]) | 0;
  }
  return String(code);
}

function storesAroundCall(kinds: Kind[], when: number): string {
  for (let i = 0; i < kinds.length; i++) {
    if (i === when) totalApart(kinds);
    kinds[i] = kinds[i] === Kind.Word ? Kind.Digit : Kind.Mark;
  }
  return String(kinds.length);
}

function constantStoresAroundCall(kinds: Kind[], when: number): string {
  for (let i = 0; i < kinds.length; i++) {
    if (i === when) totalApart(kinds);
    kinds[i] = Kind.Digit;
  }
  return String(kinds.length);
}

function rotatesAroundCall(kinds: Kind[], when: number): string {
  for (let i = 0; i < kinds.length; i++) {
    if (i === when) totalApart(kinds);
    kinds[i] = ((kinds[i] + 1) & 3) as Kind;
  }
  return String(kinds.length);
}

function pushesAroundCall(kinds: Kind[], when: number): string {
  let lengths = "";
  for (let i = 0; i < 6; i++) {
    if (i === when) totalApart(kinds);
    lengths += kinds.push((i & 3) as Kind) + ",";
  }
  return lengths;
}

function popsAroundCall(kinds: Kind[], when: number): string {
  let text = "";
  while (kinds.length > 0) {
    if (kinds.length === when + 1) totalApart(kinds);
    text += kinds.pop();
  }
  return text;
}

function appendsAroundCall(kinds: Kind[], when: number): string {
  for (let i = 0; i < 6; i++) {
    if (i === when) totalApart(kinds);
    kinds[kinds.length] = (i & 3) as Kind;
  }
  return String(kinds.length);
}

function searchesAroundCall(kinds: Kind[], when: number): string {
  const before = kinds.includes(Kind.Mark) + " " + kinds.indexOf(Kind.Digit) + " " + kinds.lastIndexOf(Kind.Word) + " " + kinds.includes(kinds[when]);
  totalApart(kinds);
  return before + " " + kinds.includes(Kind.Mark) + " " + kinds.indexOf(Kind.Digit) + " " + kinds.lastIndexOf(Kind.Word) + " " + kinds.includes(kinds[when]);
}

function searchesInLoopAroundCall(kinds: Kind[], when: number): string {
  let text = "";
  for (let kind = Kind.Space; kind <= Kind.Mark; kind++) {
    if (kind === when) totalApart(kinds);
    text += kinds.indexOf(kind) + (kinds.includes(kind) ? "y" : "n") + " ";
  }
  return text;
}

function readsAroundCall(kinds: Kind[], when: number): string {
  const before = kinds[when];
  const sum = totalApart(kinds);
  const after = kinds[when];
  return before + " " + sum + " " + after + " " + (before === after);
}

function readsAroundSmallCall(kinds: Kind[], when: number): string {
  const before = kinds[when];
  const sum = total(kinds);
  const after = kinds[when];
  return before + " " + sum + " " + after + " " + (before === after);
}

function storeCallStore(kinds: Kind[], when: number): string {
  kinds[when] = Kind.Mark;
  const sum = totalApart(kinds);
  kinds[0] = Kind.Digit;
  return sum + " " + kinds[when] + " " + kinds[0];
}

function patternsAroundCall(kinds: Kind[], when: number): string {
  const [first, second] = kinds;
  const sum = when > 0 ? totalApart(kinds) : total(kinds);
  const [third, fourth, ...others] = kinds;
  return first + " " + second + " " + sum + " " + third + " " + fourth + " " + list(others);
}

function mapAroundCall(kinds: Kind[], when: number): string {
  return list(kinds.map((kind, i) => {
    if (i === when) totalApart(kinds);
    return kind + 1;
  }));
}

function filterAroundCall(kinds: Kind[], when: number): string {
  return list(kinds.filter((kind, i) => {
    if (i === when) totalApart(kinds);
    return kind !== Kind.Word;
  }));
}

function forEachAroundCall(kinds: Kind[], when: number): string {
  let code = 0;
  kinds.forEach((kind, i) => {
    if (i === when) totalApart(kinds);
    code = (code * 5 + kind) | 0;
  });
  return String(code);
}

function reduceAroundCall(kinds: Kind[], when: number): string {
  return String(kinds.reduce((code: number, kind, i) => {
    if (i === when) totalApart(kinds);
    return (code * 5 + kind) | 0;
  }, 0));
}

function findAroundCall(kinds: Kind[], when: number): string {
  return kinds.findIndex((kind, i) => {
    if (i === when) totalApart(kinds);
    return kind === Kind.Mark;
  }) + " " + kinds.some(kind => kind === Kind.Digit) + " " + kinds.every(kind => kind <= Kind.Mark);
}

function sortAroundCall(kinds: Kind[], when: number): string {
  let calls = 0;
  kinds.sort((left, right) => {
    if (calls++ === when) totalApart(kinds);
    return left - right;
  });
  return String(kinds.length);
}

function copiesAroundCall(kinds: Kind[], when: number): string {
  const before = kinds.slice(1, 4);
  totalApart(when > 0 ? kinds : before);
  const after = kinds.slice(1, 4);
  return list(before) + " " + list(after) + " " + list([...kinds]) + " " + list(kinds.concat(before)) + " " + kinds.join("");
}

function inFinally(kinds: Kind[], when: number): string {
  let code = 0;
  try {
    code = kinds[when];
  } finally {
    totalApart(kinds);
  }
  return code + " " + kinds[when];
}

function inRecursion(kinds: Kind[], when: number, i = 0): string {
  if (i >= kinds.length) return "";
  const before = kinds[i];
  if (i === when) totalApart(kinds);
  const rest = inRecursion(kinds, when, i + 1);
  return before + "" + kinds[i] + rest;
}

function* each(kinds: Kind[]): Generator<Kind> {
  for (let i = 0; i < kinds.length; i++) yield kinds[i];
}

function generatorAroundCall(kinds: Kind[], when: number): string {
  let text = "", i = 0;
  for (const kind of each(kinds)) {
    if (i++ === when) totalApart(kinds);
    text += kind;
  }
  return text;
}

function closureAroundCall(kinds: Kind[], when: number): string {
  const read = (i: number): Kind => kinds[i];
  let text = "";
  for (let i = 0; i < kinds.length; i++) {
    if (i === when) totalApart(kinds);
    text += read(i);
  }
  return text;
}

class Meter {
  constructor(readonly values: number[]) {}
  get sum(): number {
    return totalApart(this.values);
  }
  add(): number {
    return totalApart(this.values);
  }
}

function getterInLoop(kinds: Kind[], when: number): string {
  const meter = new Meter(kinds);
  let code = 0;
  for (let i = 0; i < kinds.length; i++) {
    if (i === when) code += meter.sum;
    code = (code * 5 + kinds[i]) | 0;
  }
  return String(code);
}

function methodInLoop(kinds: Kind[], when: number): string {
  const meter = new Meter(kinds);
  let code = 0;
  for (let i = 0; i < kinds.length; i++) {
    if (i === when) code += meter.add();
    code = (code * 5 + kinds[i]) | 0;
  }
  return String(code);
}

class Line {
  constructor(public kinds: Kind[]) {}
}

function fieldAroundCall(kinds: Kind[], when: number): string {
  const line = new Line(kinds);
  let code = 0;
  for (let i = 0; i < line.kinds.length; i++) {
    if (i === when) code += totalApart(line.kinds);
    code = (code * 5 + line.kinds[i]) | 0;
  }
  return String(code);
}

function twoNames(read: Kind[], converted: Kind[], when: number): string {
  let code = 0;
  for (let i = 0; i < read.length; i++) {
    if (i === when) code += totalApart(converted);
    code = (code * 5 + read[i]) | 0;
  }
  return String(code);
}

function twoNamesStoring(stored: Kind[], converted: Kind[], when: number): string {
  for (let i = 0; i < stored.length; i++) {
    if (i === when) totalApart(converted);
    stored[i] = Kind.Mark;
  }
  return String(stored.length);
}

const inTheMiddle: [string, (kinds: Kind[], when: number) => string][] = [
  ["counts around a small call", countsAroundSmallCall],
  ["counts around a call", countsAroundCall],
  ["counts around a call that iterates", countsAroundForOfCall],
  ["counts around a deeper call", countsAroundDeeperCall],
  ["counts around one read", countsAroundOneRead],
  ["counts with a call each time", countsWithACallEachTime],
  ["adds", addsAroundCall],
  ["switches", switchesAroundCall],
  ["names", namesAroundCall],
  ["masks", masksAroundCall],
  ["text", textAroundCall],
  ["for-of", forOfAroundCall],
  ["backwards", backwardsAroundCall],
  ["stores", storesAroundCall],
  ["constant stores", constantStoresAroundCall],
  ["rotates", rotatesAroundCall],
  ["pushes", pushesAroundCall],
  ["pops", popsAroundCall],
  ["appends", appendsAroundCall],
  ["searches", searchesAroundCall],
  ["searches in a loop", searchesInLoopAroundCall],
  ["two reads", readsAroundCall],
  ["two reads around a small call", readsAroundSmallCall],
  ["two stores", storeCallStore],
  ["patterns", patternsAroundCall],
  ["map", mapAroundCall],
  ["filter", filterAroundCall],
  ["forEach", forEachAroundCall],
  ["reduce", reduceAroundCall],
  ["findIndex", findAroundCall],
  ["sort", sortAroundCall],
  ["copies", copiesAroundCall],
  ["finally", inFinally],
  ["recursion", (kinds, when) => inRecursion(kinds, when)],
  ["a generator", generatorAroundCall],
  ["a closure", closureAroundCall],
  ["a getter", getterInLoop],
  ["a method", methodInLoop],
  ["a field", fieldAroundCall],
  ["two names", (kinds, when) => twoNames(kinds, kinds, when)],
  ["two names, storing", (kinds, when) => twoNamesStoring(kinds, kinds, when)],
];

function classify(character: string): Kind {
  if (character === " ") return Kind.Space;
  if (character >= "0" && character <= "9") return Kind.Digit;
  return character >= "a" && character <= "z" ? Kind.Word : Kind.Mark;
}

function literal(): Kind[] {
  return [Kind.Word, Kind.Mark, Kind.Digit, Kind.Space, Kind.Word, Kind.Word];
}

const sources: [string, () => Kind[]][] = [
  ["a literal", literal],
  ["pushed", () => {
    const kinds: Kind[] = [];
    for (let i = 0; i < 6; i++) kinds.push(((i * 7 + 1) & 3) as Kind);
    return kinds;
  }],
  ["filled", () => new Array<Kind>(6).fill(Kind.Word)],
  ["stored into new Array(6)", () => {
    const kinds = new Array<Kind>(6);
    for (let i = 0; i < 6; i++) kinds[i] = ((i * 3 + 1) & 3) as Kind;
    return kinds;
  }],
  ["mapped", () => "a!1 bc".split("").map(classify)],
  ["parsed", () => JSON.parse("[1,3,2,0,1,1]") as Kind[]],
  ["sliced", () => literal().slice()],
  ["a hole", () => [Kind.Word, , Kind.Digit, Kind.Space, Kind.Word, Kind.Mark] as Kind[]],
  ["converted before", () => {
    const kinds = literal();
    totalApart(kinds);
    return kinds;
  }],
  ["frozen", () => Object.freeze(literal()) as Kind[]],
  ["holds a fraction", () => [1, 0.5, 2, 3, 1, 1] as Kind[]],
  ["held a text once", () => {
    const kinds: unknown[] = ["x", 3, 2, 0, 1, 1];
    kinds[0] = 1;
    return kinds as Kind[];
  }],
  ["empty", () => []],
];
const moments = [0, 2, 5];

for (const [what, run] of inTheMiddle) {
  for (const [name, make] of sources) console.log(what + ", " + name + ": " + moments.map(when => outcome(make(), kinds => run(kinds, when))).join(" ; "));
}

// The callee is a function value, and some callees leave more behind than another storage.
type Callee = (values: number[]) => number;

function countsAround(kinds: Kind[], when: number, act: Callee): string {
  let words = 0, code = 0;
  for (let i = 0; i < kinds.length; i++) {
    if (i === when) code += act(kinds);
    if (kinds[i] === Kind.Word) words++;
    code = (code * 5 + kinds[i]) | 0;
  }
  return words + " " + code;
}

function switchesAround(kinds: Kind[], when: number, act: Callee): string {
  let text = "";
  for (let i = 0; i < kinds.length; i++) {
    if (i === when) act(kinds);
    switch (kinds[i]) {
      case Kind.Space: text += "_"; break;
      case Kind.Word: text += "w"; break;
      case Kind.Digit: text += "d"; break;
      case Kind.Mark: text += "!"; break;
      default: text += "?";
    }
  }
  return text;
}

function storesAround(kinds: Kind[], when: number, act: Callee): string {
  for (let i = 0; i < kinds.length; i++) {
    if (i === when) act(kinds);
    kinds[i] = ((kinds[i] + 1) & 3) as Kind;
  }
  return String(kinds.length);
}

function pushesAround(kinds: Kind[], when: number, act: Callee): string {
  for (let i = 0; i < 6; i++) {
    if (i === when) act(kinds);
    kinds.push((i & 3) as Kind);
  }
  return String(kinds.length);
}

function namesAround(kinds: Kind[], when: number, act: Callee): string {
  let text = "";
  for (let i = 0; i < kinds.length; i++) {
    if (i === when) act(kinds);
    text += kindNames[kinds[i]] + " ";
  }
  return text;
}

const around: [string, (kinds: Kind[], when: number, act: Callee) => string][] = [
  ["counts", countsAround],
  ["switches", switchesAround],
  ["stores", storesAround],
  ["pushes", pushesAround],
  ["names", namesAround],
];
const callees: [string, Callee][] = [
  ["nothing", () => 0],
  ["total", total],
  ["a total kept apart", totalApart],
  ["through another", throughAnother],
  ["the first", firstOf],
  ["the same values stored", storesTheSame],
  ["the second halved", halvesTheSecond],
  ["a fraction pushed", pushesAFraction],
  ["NaN stored", storesNaN],
];
for (const [what, run] of around) {
  for (const [how, act] of callees) {
    for (const [name, make] of sources) console.log(what + " around " + how + ", " + name + ": " + moments.map(when => outcome(make(), kinds => run(kinds, when, act))).join(" ; "));
  }
}

// Other element types that are 32-bit integers.
function onesAroundCall(bits: Bit[], when: number): string {
  let ones = 0, word = 0;
  for (let i = 0; i < bits.length; i++) {
    if (i === when) ones += totalApart(bits) * 100;
    ones += bits[i];
    word = (word << 1) | bits[i];
  }
  return ones + " " + word;
}

function flipsAroundCall(bits: Bit[], when: number): string {
  for (let i = 0; i < bits.length; i++) {
    if (i === when) totalApart(bits);
    bits[i] = bits[i] === 1 ? 0 : 1;
  }
  return String(bits.length);
}

function levelsAroundCall(levels: Level[], when: number): string {
  let text = "";
  for (let i = 0; i < levels.length; i++) {
    if (i === when) totalApart(levels);
    text += levels[i] === 1 ? "low " : levels[i] === 2 ? "middle " : "high ";
  }
  return text;
}

for (const when of moments) {
  console.log("bits: " + outcome<Bit>([1, 0, 0, 1, 1, 1], bits => onesAroundCall(bits, when)) + " ; " + outcome<Bit>([1, 0, 0, 1, 1, 1], bits => flipsAroundCall(bits, when)) + " ; " + outcome(JSON.parse("[0,1,1,0,1,0]") as Bit[], bits => onesAroundCall(bits, when)));
  console.log("levels: " + outcome<Level>([1, 2, 3, 3, 2, 1], levels => levelsAroundCall(levels, when)) + " ; " + outcome(JSON.parse("[3,2,1,1,2,3]") as Level[], levels => levelsAroundCall(levels, when)));
}

// One literal, many arrays: what happens to the storage of one does not reach the others.
const copies = [literal(), literal(), literal(), literal()];
console.log(totalApart(copies[0]) + " " + halvesTheSecond(copies[1]) + " " + pushesAFraction(copies[2]) + " " + copies.map(list).join(" ") + " " + list(literal()) + " " + switchesAroundCall(literal(), 9) + " " + switchesAroundCall(copies[0], 9) + " " + switchesAroundCall(copies[1], 9));

// One table that many functions read, before and after.
const table: Kind[] = [Kind.Mark, Kind.Digit, Kind.Word, Kind.Space, Kind.Word, Kind.Mark];
console.log(switchesAroundCall(table, 9) + " " + masksAroundCall(table, 9) + " " + table.indexOf(Kind.Space) + " " + list(table));
console.log(totalApart(table) + " " + total(table) + " " + totalOfApart(table));
console.log(switchesAroundCall(table, 9) + " " + masksAroundCall(table, 9) + " " + table.indexOf(Kind.Space) + " " + list(table));
table[1] = Kind.Space;
table.push(Kind.Digit);
console.log(switchesAroundCall(table, 9) + " " + masksAroundCall(table, 9) + " " + table.indexOf(Kind.Space) + " " + totalApart(table) + " " + list(table));

// Arrays of integers that no function takes for doubles, and arrays that only functions of this group take as `number[]`.
function codeOfOwn(kinds: Kind[]): number {
  let code = 0;
  for (let i = 0; i < kinds.length; i++) code = (code * 5 + kinds[i]) | 0;
  return code;
}
const neverNumbers: Kind[] = [Kind.Digit, Kind.Mark, Kind.Space];
neverNumbers.push(Kind.Word);
console.log("never taken as numbers: " + codeOfOwn(neverNumbers) + " " + codeOfOwn([Kind.Mark, Kind.Mark]) + " " + codeOfOwn([]));

function codeOfShared(kinds: Kind[], when: number): number {
  let code = 0;
  for (let i = 0; i < kinds.length; i++) {
    if (i === when) code += totalOfOwn(kinds);
    code = (code * 5 + kinds[i]) | 0;
  }
  return code;
}
function totalOfOwn(values: number[]): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  return sum;
}
const sharedKinds: Kind[] = [Kind.Digit, Kind.Mark, Kind.Space, Kind.Word];
console.log("taken as numbers by typed code only: " + codeOfShared(sharedKinds, 1) + " " + totalOfOwn(sharedKinds) + " " + codeOfShared(sharedKinds, 9) + " " + totalOfOwn([1, 2, 3]) + " " + codeOfShared([Kind.Word], 0));

function codeBesideFractions(kinds: Kind[], when: number): number {
  let code = 0;
  for (let i = 0; i < kinds.length; i++) {
    if (i === when) code += totalBesideFractions(kinds);
    code = (code * 5 + kinds[i]) | 0;
  }
  return code;
}
function totalBesideFractions(values: number[]): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  return sum;
}
const besideFractions: Kind[] = [Kind.Digit, Kind.Mark, Kind.Space, Kind.Word];
console.log("taken as numbers beside arrays of fractions: " + totalBesideFractions([0.5, 1.5]) + " " + codeBesideFractions(besideFractions, 1) + " " + totalBesideFractions(besideFractions) + " " + codeBesideFractions(besideFractions, 9));

// The reader is suspended when the storage changes.
async function slowly(kinds: Kind[]): Promise<string> {
  let text = "", code = 0;
  for (let i = 0; i < kinds.length; i++) {
    text += kinds[i];
    code = (code * 5 + kinds[i]) | 0;
    await null;
  }
  return text + " " + code;
}

async function slowlyStoring(kinds: Kind[]): Promise<string> {
  for (let i = 0; i < kinds.length; i++) {
    kinds[i] = ((kinds[i] + 1) & 3) as Kind;
    await null;
  }
  return list(kinds);
}

const pending: Promise<string>[] = [];
for (const [name, make] of sources) {
  if (name === "frozen") continue;
  const read = make(), stored = make();
  const reading = slowly(read), storing = slowlyStoring(stored);
  const sums = totalApart(read) + " " + totalApart(stored);
  pending.push(Promise.all([reading, storing]).then(([first, second]) => "suspended, " + name + ": " + sums + " " + first + " " + second));
}
Promise.all(pending).then(lines => {
  for (const line of lines) console.log(line);
});
