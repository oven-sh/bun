type Table = Record<string, (x: number) => number>;
const xs: number[] = JSON.parse("[" + Array.from({ length: 40 }, (_, k) => k % 11).join() + "]");
const key: any = JSON.parse('"go"');
const names: string[] = JSON.parse('["go","no"]');
const make = (): Table => ({ go: x => x + 1, no: x => x * 2 });

function show(name: string, run: (table: any) => unknown, table: any): void {
  const said: string[] = [];
  for (let round = 0; round < 2; round++) {
    try {
      said.push(String(run(table)));
    } catch (error) {
      said.push(error instanceof Error ? error.name : String(error));
    }
  }
  console.log(name, said.join(" "));
}

const replaced: Table = { go: x => (x === 7 ? ((replaced.go = y => y + 1000), x) : x + 1), no: x => x * 2 };
function replacedByItself() {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += replaced[key]!(xs[i]!);
  return s;
}
const stored: Table = make();
function storedInTheLoop() {
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    s += stored[key]!(xs[i]!);
    if (i === 20) stored[names[0]!] = x => x * 100;
  }
  return s;
}
const fields = { count: 0, go: (x: number) => x + 1, no: (x: number) => x * 2 };
function storedByName() {
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    s += (fields as any)[key](xs[i]);
    fields.count++;
    if (i === 20) fields.go = x => x - 50;
  }
  return s + fields.count;
}
const swapped = { n: 1, go(x: number) { return x + this.n; }, no(x: number) { return x * 2; } };
function swappedInEachIteration() {
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    s += (swapped as any)[key](xs[i]);
    const was = swapped.go;
    swapped.go = swapped.no;
    swapped.no = was;
  }
  return s;
}
const withGetter: Table = make();
let asked = 0;
function getterLaid() {
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    s += withGetter[key]!(xs[i]!);
    if (i === 10) Object.defineProperty(withGetter, "go", { configurable: true, get: () => (asked++, (x: number) => x * 3) });
  }
  return s + asked;
}
const deleted: Table = make();
function deletedInTheLoop() {
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    s += deleted[names[i & 1]!]!(xs[i]!);
    if (i === 12) delete deleted.no;
  }
  return s;
}
const elements: any = { go: (x: number) => x + 1, no: (x: number) => x * 2, 7: (x: number) => x * 70 };
const listKey: any[] = ["go"];
function keyIsAList() {
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    s += elements[listKey as any](xs[i]);
    if (i === 15) listKey[0] = "no";
    if (i === 25) listKey[0] = "7";
  }
  return s;
}
let conversions = 0;
const objectKey: any = { toString: () => (conversions++ % 3 ? "go" : "no") };
function keyIsConverted() {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += elements[objectKey](xs[i]);
  return s + conversions;
}
const elementKey: any = JSON.parse('"7"');
function keyNamesAnElement() {
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    s += elements[elementKey](xs[i]);
    if (i === 20) elements[7] = (x: number) => x + 7000;
  }
  return s;
}
let changing: any = "go";
function keyIsAssigned() {
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    s += elements[changing](xs[i]);
    if (i % 5 === 4) changing = changing === "go" ? "no" : "go";
  }
  return s;
}
class Tool {
  n = 1;
  go(x: number) { return x + this.n; }
  no(x: number) { this.n++; return x * 2; }
}
const tool: any = new Tool();
function prototypeChanged() {
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    s += tool[names[i & 1]!](xs[i]);
    if (i === 9) (Tool.prototype as any).go = function (this: Tool, x: number) { return x + 100 * this.n; };
    if (i === 30) tool.no = (x: number) => -x;
  }
  return s;
}
class Statics {
  static go(x: number) { return x + 1; }
  static no(x: number) { return x * 2; }
}
function staticChanged() {
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    s += (Statics as any)[names[i & 1]!](xs[i]) + (Statics as any)[key](i);
    if (i === 22) (Statics as any).go = (x: number) => x * 1000;
  }
  return s;
}
const frozen: any = make();
function frozenInTheLoop() {
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    s += frozen[key](xs[i]);
    if (i === 5) Object.freeze(frozen);
    if (i > 5) try { frozen.go = null; } catch { s += 1; }
  }
  return s;
}
const heir: any = Object.create({ go: (x: number) => x + 5, no: (x: number) => x * 5 });
function shadowed() {
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    s += heir[key](xs[i]);
    if (i === 13) heir.go = (x: number) => x * 1000;
    if (i === 26) delete heir.go;
    if (i === 33) Object.setPrototypeOf(heir, { go: (x: number) => 1 });
  }
  return s;
}
const throwing: Table = { go: x => { if (x === 9) throw new RangeError("nine"); return x; }, no: x => x };
function thrown() {
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    try {
      s += throwing[names[i & 1]!]!(xs[i]!);
    } catch (error) {
      s += error instanceof RangeError ? 10000 : 1;
    }
  }
  return s;
}
for (const [name, run] of Object.entries({ replacedByItself, storedInTheLoop, storedByName, swappedInEachIteration, getterLaid, deletedInTheLoop, keyIsAList, keyIsConverted, keyNamesAnElement, keyIsAssigned, prototypeChanged, staticChanged, frozenInTheLoop, shadowed, thrown })) show(name, run, null);
let total = 0;
const own: Table = make();
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < xs.length; i++) {
    total += own[key]!(xs[i]!);
    if (round === 1 && i === 20) own[key] = x => x + 10000;
  }
}
console.log(total);
