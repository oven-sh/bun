// One class makes the objects of a union: `new Node(1) as Num`, `new Node(2) as Str`, where the interfaces below the class write one literal each for `kind`. The class declares its fields, one class with initial values and one without, so its constructor runs an initializer. The objects pass for the interfaces: the functions that take a Num or a Str run their typed code on them.
// STATISTIC: TaggedLayoutsNeverAllocated = 0
// STATISTIC: ShapeTestNeverPasses = 0
class Plain {
  kind: number;
  pos: number;
  constructor(kind: number) { this.kind = kind; this.pos = 0; }
}
interface PlainNum extends Plain { kind: 1; value: number }
interface PlainStr extends Plain { kind: 2; text: string }
function plainNum(v: number): PlainNum { const n = new Plain(1) as PlainNum; n.value = v; return n; }
function plainStr(t: string): PlainStr { const n = new Plain(2) as PlainStr; n.text = t; return n; }
function plainValue(n: PlainNum): number { return n.value + n.pos; }
function plainText(n: PlainStr): number { return n.text.length + n.pos; }
function plainEither(n: PlainNum | PlainStr): number { return n.kind === 1 ? n.value : n.text.length; }

class Filled {
  kind: number;
  pos = 3;
  constructor(kind: number) { this.kind = kind; }
}
interface FilledNum extends Filled { kind: 1; amount: number }
interface FilledStr extends Filled { kind: 2; label: string }
function filledNum(v: number): FilledNum { const n = new Filled(1) as FilledNum; n.amount = v; return n; }
function filledStr(t: string): FilledStr { const n = new Filled(2) as FilledStr; n.label = t; return n; }
function filledValue(n: FilledNum): number { return n.amount + n.pos; }
function filledText(n: FilledStr): number { return n.label.length + n.pos; }
function filledEither(n: FilledNum | FilledStr): number { return n.kind === 1 ? n.amount : n.label.length; }

const plainNums: PlainNum[] = [], plainStrs: PlainStr[] = [], filledNums: FilledNum[] = [], filledStrs: FilledStr[] = [];
for (let i = 0; i < 100; i++) {
  plainNums.push(plainNum(i)); plainStrs.push(plainStr("t" + i));
  filledNums.push(filledNum(i)); filledStrs.push(filledStr("t" + i));
}
let total = 0;
for (let k = 0; k < 500; k++) {
  for (let i = 0; i < 100; i++) {
    total = (total + plainValue(plainNums[i]) + plainText(plainStrs[i]) + filledValue(filledNums[i]) + filledText(filledStrs[i])) | 0;
    total = (total + plainEither(plainNums[i]) + plainEither(plainStrs[i]) + filledEither(filledNums[i]) + filledEither(filledStrs[i])) | 0;
  }
}
console.log(total + " " + Object.keys(plainNums[7]).join() + " " + Object.keys(plainStrs[7]).join() + " " + Object.keys(filledNums[7]).join() + " " + Object.keys(filledStrs[7]).join());
console.log(JSON.stringify(plainNums[7]) + " " + JSON.stringify(filledStrs[7]) + " " + (plainNums[7] instanceof Plain) + " " + (filledStrs[7] instanceof Filled));
