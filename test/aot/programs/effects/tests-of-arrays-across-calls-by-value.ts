// A test of an array that is placed in front of a loop holds across the calls by value in the loop where every callee is known and leaves the array alone: bound functions out of a table, closures out of a table, a callback, methods of many classes, getters, a callback inside forEach. Where a callee really changes the array, through `this`, an argument, a captured variable or a variable of the module, the loop sees the change
type Step = (value: number) => number;

const counter = { n: 0 };
function add(this: { n: number }, value: number): number { this.n += value; return value + 1 }
function subtract(this: { n: number }, value: number): number { this.n -= value; return value - 1 }
const bound: Step[] = [add.bind(counter), subtract.bind(counter), add.bind(counter)];
function boundOutOfTable(rounds: number): number { let sum = 0; for (let i = 0; i < rounds; i++) sum += bound[i % 3](i); return sum }

const steps: Step[] = [v => v + 1, v => v * 2, v => v - 3, v => v % 7, v => -v, v => v * v, v => v >> 1, v => v ^ 5];
function closuresInOrder(start: number): number { let value = start; for (const step of steps) value = step(value); return value }
function closuresByIndex(values: number[]): number { let sum = 0; for (let i = 0; i < values.length; i++) sum += steps[i & 7](values[i]) + values[i]; return sum }
function callback(values: number[], step: Step): number { let sum = 0; for (let i = 0; i < values.length; i++) sum += step(values[i]) + values.length; return sum }
function callbackInsideForEach(values: number[], step: Step): number { let different = 0; values.forEach((value, index) => { if (step(index) !== value) different++ }); return different }

interface Reader { read(): number }
class One implements Reader { read(): number { return 1 } }
class Two implements Reader { k = 2; read(): number { return this.k } }
class Three implements Reader { a = 1; b = 2; read(): number { return this.a + this.b } }
class Four implements Reader { text = "four"; read(): number { return this.text.length } }
class Five implements Reader { list = [1, 2, 2]; read(): number { return this.list[0] + this.list[1] + this.list[2] } }
class Six implements Reader { inner = new Three(); read(): number { return this.inner.read() * 2 } }
class Seven implements Reader { seed: number; read: () => number; constructor(seed: number) { this.seed = seed; this.read = () => this.seed } }
function methodsOfManyClasses(readers: Reader[]): number { let sum = 0; for (let k = 0; k < readers.length; k++) sum += readers[k].read(); return sum }

class Celsius { degrees: number; constructor(degrees: number) { this.degrees = degrees } get text(): string { return this.degrees + "C" } }
class Kelvin { degrees: number; constructor(degrees: number) { this.degrees = degrees } get text(): string { return this.degrees + 273 + "K" } }
class Unknown { get text(): string { return "?" } }
function getters(list: Array<Celsius | Kelvin | Unknown>): number { let n = 0; for (let round = 0; round < 30; round++) n += list[(round * 7) % list.length].text.length; return n }

let shared: Array<number | string> = [];
const quiet: Step[] = [v => v, v => v + 1, v => v + 2, v => v + 3, v => v + 4, v => v + 5];
const shrinking: Step[] = [v => v, v => v + 1, v => { shared.length = 3; return v }, v => v + 3, v => v + 4, v => v + 5];
const storingText: Step[] = [v => v, v => { shared[3] = "text"; return v }, v => v + 2, v => v + 3, v => v + 4, v => v + 5];
const storingFraction: Step[] = [v => { shared[2] = 2.5; return v }, v => v + 1, v => v + 2, v => v + 3, v => v + 4, v => v + 5];
const growing: Step[] = [v => v, v => v + 1, v => v + 2, v => v + 3, v => { if (shared.length < 8) shared[7] = 7; return v }, v => v + 5];
function variableOfTheModule(list: Array<number | string>, table: Step[]): string { let text = ""; for (let i = 0; i < list.length; i++) text += list[i] + ":" + table[i % table.length](i) + " "; return text }

type Entry = (this: Entry[], index: number) => number;
function keeps(this: Entry[], index: number): number { return index }
function counts(this: Entry[], index: number): number { return this.length + index }
function doubles(this: Entry[], index: number): number { return index * 2 }
function truncates(this: Entry[], index: number): number { this.length = index + 1; return -1 }
function tableAsThis(table: Entry[]): number { let sum = 0; for (let i = 0; i < table.length; i++) sum += table[i](i); return sum }

type Visitor = (list: number[], index: number) => number;
const visitors: Visitor[] = [
  (list, i) => list[i],
  (list, i) => list[i] * 2,
  (list, i) => { if (i + 1 < list.length) list[i + 1] = 0.5; return list[i] },
  (list, i) => { if (list.length > i + 2) list.length = i + 2; return 1 },
  (list, i) => list.length,
  (list, i) => { if (list.length < 7) list.push(i); return i },
];
function arrayAsArgument(list: number[], visitor: Visitor): number { let sum = 0; for (let i = 0; i < list.length; i++) sum += visitor(list, i) + list[i]; return sum }

function capturedArray(): string {
  const local: Array<number | string> = [1, 2, 3, 4, 5, 6];
  const table: Step[] = [v => v, v => v + 1, v => { local[3] = "x"; return v }, v => v * 2, v => { local.length = 5; return v }, v => v + 7];
  let text = "";
  for (let i = 0; i < local.length; i++) text += local[i] + ":" + table[i](i) + " ";
  return text;
}

for (let round = 0; round < 3; round++) {
  counter.n = round;
  console.log("bound", boundOutOfTable(1000 + round), counter.n);
  console.log("closures in order", closuresInOrder(round + 3));
  console.log("closures by index", closuresByIndex([1, 2, 3, 4, 5, 6, 7, 8, 9, round]));
  let all = 0; for (const step of steps) all += callback([1, 2, 3, round], step); console.log("callback", all);
  let different = 0; for (const step of steps) different += callbackInsideForEach([1, 2, -1, round], step); console.log("callback inside forEach", different);
  console.log("methods", methodsOfManyClasses([new One(), new Two(), new Three(), new Four(), new Five(), new Six(), new Seven(round)]));
  console.log("getters", getters([new Celsius(round), new Kelvin(round), new Unknown(), new Celsius(100), new Kelvin(-300)]));
  for (const table of [quiet, shrinking, storingText, storingFraction, growing]) { shared = [1, 2, 3, 4, 5, 6]; console.log("variable of the module", variableOfTheModule(shared, table), shared.length) }
  console.log("table as this", tableAsThis([keeps, counts, doubles, keeps, counts, doubles]), tableAsThis([keeps, counts, doubles, truncates, counts, doubles]));
  for (const visitor of visitors) { const list = [1, 2, 3, 4, 5]; console.log("array as argument", arrayAsArgument(list, visitor), list.join()) }
  console.log("captured", capturedArray());
}
