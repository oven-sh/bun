// dlopen and calls into libc only pass numbers and pointers, so they must not pull util.inspect into the executable.
// STATISTIC: ImageFunctionsEmitted <= 100
import { dlopen, FFIType, ptr } from "bun:ffi";

const names =
  process.platform === "darwin"
    ? ["libSystem.B.dylib"]
    : process.platform === "win32"
      ? ["ucrtbase.dll"]
      : ["libc.so.6", `libc.musl-${process.arch === "arm64" ? "aarch64" : "x86_64"}.so.1`, "libc.so.7", "libc.so"];

function open(symbols) {
  for (const name of names) {
    try {
      return dlopen(name, symbols);
    } catch {}
  }
  throw new Error("could not find libc");
}

class Surface {
  constructor(id, width, height) {
    this.id = id;
    this.width = width;
    this.height = height;
  }
  area() {
    return this.width * this.height;
  }
}

const inSet = new Set();
const byId = new Map();
const inOrder = [];
let sum = 0;
for (let i = 0; i < 100; i++) {
  const surface = new Surface(i, (i & 7) + 1, (i & 3) + 1);
  inSet.add(surface);
  byId.set(i & 15, surface);
  inOrder.push(surface);
  sum += byId.get(i & 15).area();
}
for (const surface of inSet) sum += surface.height;

const library = open({
  abs: { args: [FFIType.i32], returns: FFIType.i32 },
  strlen: { args: [FFIType.ptr], returns: FFIType.u64 },
});
const text = new Uint8Array([104, 101, 108, 108, 111, 0]);
console.log(
  String(sum),
  String(inOrder.length),
  String(library.symbols.abs(-7)),
  String(library.symbols.strlen(ptr(text))),
);
library.close();
