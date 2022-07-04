import {
  viewSource,
  dlopen,
  CString,
  ptr,
  toBuffer,
  toArrayBuffer,
  FFIType,
  callback,
} from "bun:ffi";

import { bench, group, run } from "mitata";

var buffer = new Uint8Array(32);
var bufferPtr = ptr(buffer);
var arrayBuffer = new ArrayBuffer(32);
bench("ptr(Uint8Array)", () => {
  return ptr(buffer);
});

bench("ptr(ArrayBuffer)", () => {
  return ptr(arrayBuffer);
});

bench("toBuffer(ptr)", () => {
  return toBuffer(bufferPtr, 32);
});

bench("toArrayBuffer(ptr)", () => {
  return toArrayBuffer(bufferPtr, 32);
});

await run();
