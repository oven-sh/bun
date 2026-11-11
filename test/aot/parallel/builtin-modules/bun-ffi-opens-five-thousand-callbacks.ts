// The entry points of callbacks are code of the executable, which makes no code while it runs. It maps that code as often as the program needs entry points: each callback is called through its own.
import { CFunction, FFIType, JSCallback } from "bun:ffi";

const open: JSCallback[] = [];
for (let i = 0; i < 5000; i++) open.push(new JSCallback((value: number) => value + i, { args: [FFIType.i32], returns: FFIType.i32 }));
const addresses = new Set(open.map(callback => callback.ptr));
let answeredByTheirOwn = 0;
for (let i = 0; i < open.length; i++) {
  const call = CFunction({ ptr: open[i].ptr!, args: [FFIType.i32], returns: FFIType.i32 });
  if (call(1) === i + 1) answeredByTheirOwn++;
}
console.log(open.length, addresses.size, answeredByTheirOwn);

// One that is closed gives its entry point back, wherever it lies, and the neighbors go on answering.
for (const index of [3, 300, 4999]) open[index].close();
const taken = [0, 1, 2].map(turn => new JSCallback(() => turn, { args: [], returns: FFIType.i32 }));
const call = (callback: JSCallback, ...values: number[]) => CFunction({ ptr: callback.ptr!, args: values.map(() => FFIType.i32), returns: FFIType.i32 })(...values);
console.log(taken.map(callback => call(callback)).join(), call(open[2], 1), call(open[4], 1), call(open[299], 1), call(open[301], 1), call(open[4998], 1), open[300].ptr);
for (const callback of [...open, ...taken]) callback.close();

let sum = 0;
for (let i = 0; i < 2000; i++) {
  const once = new JSCallback((value: number) => value + i, { args: [FFIType.i32], returns: FFIType.i32 });
  sum += CFunction({ ptr: once.ptr!, args: [FFIType.i32], returns: FFIType.i32 })(1);
  once.close();
}
console.log(sum);
/* Output:
5000 5000 5000
0,1,2 3 5 300 302 4999 null
2001000
*/
