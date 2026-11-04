// A literal of small integers that only code of the program holds is stored as 32-bit integers, and whoever reads it by its own name counts on that without a test. The same array also lies in a position of type `number[]` which something that is no array reaches through `any`: a variable, a captured variable, a field, a result, an element. The code behind that position counts on doubles, and may turn the storage into doubles the first time it meets the integers. Nothing of it can be seen: every line is plain Bun's.
// STATISTIC: IntegerArrayConversionsPlaced >= 1
const n = process.argv.length & 1;
function sum(xs: number[]): number {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return s;
}

const besideObject = [n + 1, n + 2, n + 3];
let variable: number[] = besideObject;
function putVariable(v: any) { variable = v; }
function totalOfVariable(): number { const xs = variable; let s = 0; for (let i = 0; i < xs.length; i++) s += xs[i]; return s; }
function readBesideObject(): number { return besideObject[0] + besideObject[1] + besideObject[2]; }

const besideFunction = [n + 1, n + 2, n + 3];
let second: number[] = besideFunction;
function putSecond(v: any) { second = v; }
function totalOfSecond(): number { const xs = second; let s = 0; for (let i = 0; i < xs.length; i++) s += xs[i]; return s; }
function readBesideFunction(): number { return besideFunction[0] + besideFunction[1] + besideFunction[2]; }

const besideString = [n + 1, n + 2, n + 3];
let third: number[] = besideString;
function putThird(v: any) { third = v; }
function totalOfThird(): number { const xs = third; let s = 0; for (let i = 0; i < xs.length; i++) s += xs[i]; return s; }
function readBesideString(): number { return besideString[0] + besideString[1] + besideString[2]; }

const inField = [n + 1, n + 2, n + 3];
class Box { list: number[]; constructor(list: number[]) { this.list = list; } }
const box = new Box(inField);
function putField(v: any) { box.list = v; }
function totalOfField(): number { const xs = box.list; let s = 0; for (let i = 0; i < xs.length; i++) s += xs[i]; return s; }
function readInField(): number { return inField[0] + inField[1] + inField[2]; }

const returned = [n + 1, n + 2, n + 3];
let turn = 0;
function pick(): number[] { turn++; return turn === 20001 ? ({ length: 0 } as any) : returned; }
function totalOfResult(): number { const xs = pick(); let s = 0; for (let i = 0; i < xs.length; i++) s += xs[i]; return s; }
function readReturned(): number { return returned[0] + returned[1] + returned[2]; }

const inRow = [n + 1, n + 2, n + 3];
const rows: number[][] = [inRow, { length: 0 } as any];
function totalOfRow(k: number): number { const xs = rows[k]; let s = 0; for (let i = 0; i < xs.length; i++) s += xs[i]; return s; }
function readInRow(): number { return inRow[0] + inRow[1] + inRow[2]; }

function capture() {
  const own = [n + 1, n + 2, n + 3];
  let captured: number[] = own;
  return {
    put(v: any) { captured = v; },
    total(): number { const xs = captured; let s = 0; for (let i = 0; i < xs.length; i++) s += xs[i]; return s; },
    read(): number { return own[0] + own[1] + own[2]; },
  };
}
const closures = capture();

const totals = [0, 0, 0, 0, 0, 0, 0];
for (let k = 0; k < 20000; k++) {
  totals[0] += totalOfVariable() + readBesideObject();
  totals[1] += totalOfSecond() + readBesideFunction();
  totals[2] += totalOfThird() + readBesideString();
  totals[3] += totalOfField() + readInField();
  totals[4] += totalOfResult() + readReturned();
  totals[5] += totalOfRow(0) + readInRow();
  totals[6] += closures.total() + closures.read();
}
putVariable({ length: 0 }); totals[0] += totalOfVariable(); putVariable(besideObject);
putSecond(sum); console.log(totalOfSecond()); putSecond(besideFunction);
putThird("xy"); console.log(totalOfThird()); putThird(besideString);
putField({ length: 0 }); totals[3] += totalOfField(); putField(inField);
totals[4] += totalOfResult();
totals[5] += totalOfRow(1);
closures.put({ length: 0 }); totals[6] += closures.total();

console.log("a variable, an object: " + totals[0] + " " + besideObject[0] + " " + besideObject[1] + " " + besideObject[2] + " " + readBesideObject() + " " + totalOfVariable());
console.log("a variable, a function: " + totals[1] + " " + besideFunction[0] + " " + besideFunction[1] + " " + besideFunction[2] + " " + readBesideFunction() + " " + totalOfSecond());
console.log("a variable, a string: " + totals[2] + " " + besideString[0] + " " + besideString[1] + " " + besideString[2] + " " + readBesideString() + " " + totalOfThird());
console.log("a field: " + totals[3] + " " + inField[0] + " " + inField[1] + " " + inField[2] + " " + readInField() + " " + totalOfField());
console.log("a result: " + totals[4] + " " + returned[0] + " " + returned[1] + " " + returned[2] + " " + readReturned());
console.log("an element: " + totals[5] + " " + inRow[0] + " " + inRow[1] + " " + inRow[2] + " " + readInRow() + " " + totalOfRow(0));
console.log("a captured variable: " + totals[6] + " " + closures.read());
