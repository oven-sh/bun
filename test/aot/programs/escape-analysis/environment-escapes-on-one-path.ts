// Captured variables escape on one path only: a closure over the variables of a loop is stored when a flag is set. What the function and the stored closure write after that goes to one variable, and the result is the same as with the flag clear.
declare const edenGC: undefined | (() => void);
const collectYoung: () => void = typeof edenGC === "function" ? edenGC : require("bun:jsc").edenGC;

type Box = { value: number };
const saved: ((step: number) => number)[] = [];

function variablesOfOneIteration(turns: number, escapes: boolean): string {
  let out = "";
  for (let turn = 0; turn < turns; turn++) {
    let total = turn;
    let text = "t";
    if (escapes) saved.push(step => { total += step; text += step; return total; });
    total += 100;
    text += "f";
    let afterClosure: number;
    if (escapes) afterClosure = saved[saved.length - 1](7);
    else { total += 7; text += 7; afterClosure = total; }
    total *= 2;
    let afterFunction: number;
    if (escapes) afterFunction = saved[saved.length - 1](0);
    else { text += 0; afterFunction = total; }
    out += afterClosure + ":" + afterFunction + ":" + total + text + ";";
  }
  return out;
}

function variablesOfAllIterations(turns: number, escapes: boolean): string {
  let total = 0;
  let text = "";
  const first = saved.length;
  for (let turn = 0; turn < turns; turn++) {
    if (escapes && turn % 2 === 1) saved.push(step => { total += step; text += "c"; return total; });
    total += 10;
    text += "f";
  }
  for (let k = 0; k < turns >> 1; k++) {
    if (escapes) saved[first + k](k);
    else { total += k; text += "c"; }
    total += 1000;
  }
  return total + text;
}

function objectsAcrossCollections(turns: number, escapes: boolean): number {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    let box: Box = { value: turn };
    if (escapes) saved.push(step => { const old = box.value; box = { value: old + step }; return old; });
    collectYoung();
    box = { value: box.value + 1 };
    collectYoung();
    if (escapes) sum += saved[saved.length - 1](5);
    else { sum += box.value; box = { value: box.value + 5 }; }
    collectYoung();
    sum += box.value;
  }
  return sum;
}

let differences = 0;
let out = "";
for (let round = 0; round < 600; round++) {
  const turns = round % 7;
  const flag = round % 3 === 0;
  const one = variablesOfOneIteration(turns, flag);
  const all = variablesOfAllIterations(turns, flag);
  if (one !== variablesOfOneIteration(turns, !flag) || all !== variablesOfAllIterations(turns, !flag)) differences++;
  if (round % 97 === 5) out += flag + " " + one + " | " + all + "\n";
  saved.length = 0;
}
for (let round = 0; round < 4; round++) {
  const flag = round % 2 === 0;
  out += flag + " " + objectsAcrossCollections(20, flag) + "\n";
  saved.length = 0;
}
console.log(out + "differences: " + differences);
