import { CFunction, FFIType, JSCallback } from "bun:ffi";

declare var self: Worker;
const open: JSCallback[] = [];
for (let i = 0; i < 400; i++) open.push(new JSCallback((value: number) => value * 2 + i, { args: [FFIType.i32], returns: FFIType.i32 }));
let right = 0;
for (let i = 0; i < open.length; i++) right += CFunction({ ptr: open[i].ptr!, args: [FFIType.i32], returns: FFIType.i32 })(1) === i + 2 ? 1 : 0;
self.onmessage = () => {
  for (const callback of open) callback.close();
  process.exit(0);
};
self.postMessage({ right, addresses: open.map(callback => Number(callback.ptr)) });
