// signal() of the C library, found by its name through bun:ffi, sets the action of a signal. Reading a property of null goes on throwing a TypeError.
import { dlopen, FFIType } from "bun:ffi";

const names =
  process.platform === "darwin"
    ? ["libSystem.B.dylib"]
    : process.platform === "win32"
      ? ["ucrtbase.dll"]
      : ["libc.so.6", `libc.musl-${process.arch === "arm64" ? "aarch64" : "x86_64"}.so.1`, "libc.so.7", "libc.so"];

function open() {
  for (const name of names) {
    try {
      return dlopen(name, { signal: { args: [FFIType.i32, FFIType.ptr], returns: FFIType.ptr } });
    } catch {}
  }
  throw new Error("this platform's C library has another name");
}

function readX(point: { x: number } | null): number {
  return point!.x;
}
function readXPlusOne(point: { x: number } | null): number {
  return point!.x + 1;
}
const readers = [readX, readXPlusOne];
const none: { x: number } | null = JSON.parse("null");

const library = open();
let caught = 0;
for (let i = 0; i < 10; i++) {
  try {
    readers[i & 1](none);
  } catch (error) {
    if (error instanceof TypeError) caught++;
  }
}
console.log("at first", caught);

const SIGSEGV = 11;
library.symbols.signal(SIGSEGV, null);

caught = 0;
for (let i = 0; i < 10; i++) {
  try {
    readers[i & 1](none);
  } catch (error) {
    if (error instanceof TypeError) caught++;
  }
}
console.log("in the end", caught);
