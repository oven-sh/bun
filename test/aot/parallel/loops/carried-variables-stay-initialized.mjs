// A variable of another module that a loop carries has left its dead zone before the loop.
import { helper, captured, offset } from "./carried-variables-stay-initialized/part.mjs";
const printValue = console.log;
const list = new Float64Array([2, 2, -1, 1, 3, -1, 1, 10]);
const notes = [];
let total = 0;
try {
  for (let turn0 = 0; turn0 < list.length && turn0 < 12; turn0++) {
    notes.push(String(list.some(function (value0, index0, array0) { notes.push(String(list.findIndex((value1, index1, array1) => { total += captured; return value1 > captured; }))); return (value0) === this.mark; }, { mark: 1 })));
    total += Number(list[turn0 * 0.5 + 0.5]);
    list[turn0 + 1] = captured;
  }
} catch (error) {
  console.log("threw", error.name);
}
console.log(total, captured, offset, notes.join(), Array.from(list, value => String(value)).join("|"));
export {};
