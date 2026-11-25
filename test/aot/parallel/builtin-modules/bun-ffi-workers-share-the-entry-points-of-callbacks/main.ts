// Entry points: ./worker.ts
// All threads of the process take their entry points from one pool. Three threads hold 400 callbacks each at the same time, and no two have one address.
import { CFunction, FFIType, JSCallback } from "bun:ffi";

const open: JSCallback[] = [];
for (let i = 0; i < 400; i++) open.push(new JSCallback((value: number) => value + i, { args: [FFIType.i32], returns: FFIType.i32 }));
const workers = [1, 2].map(() => new Worker(new URL("./worker.ts", import.meta.url).href));
const reports = await Promise.all(workers.map(worker => new Promise<{ right: number; addresses: number[] }>(resolve => { worker.onmessage = event => resolve(event.data); })));
let right = 0;
for (let i = 0; i < open.length; i++) right += CFunction({ ptr: open[i].ptr!, args: [FFIType.i32], returns: FFIType.i32 })(1) === i + 1 ? 1 : 0;
const addresses = new Set([...open.map(callback => Number(callback.ptr)), ...reports.flatMap(report => report.addresses)]);
console.log(right, reports.map(report => report.right).join(), addresses.size);
for (const worker of workers) worker.postMessage("close");
for (const callback of open) callback.close();
/* Output:
400 400,400 1200
*/
