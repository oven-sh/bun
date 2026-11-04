// bun:ffi in an executable: the code that passes arguments to a foreign function, and the entry points of callbacks, are in the
// executable, so nothing is generated when the program runs.
import { CFunction, dlopen, FFIType, JSCallback, linkSymbols, type Pointer, ptr, read, suffix, toBuffer } from "bun:ffi";

const names =
  process.platform === "darwin"
    ? ["libSystem.B.dylib"]
    : process.platform === "win32"
      ? ["ucrtbase.dll"]
      : ["libc.so.6", `libc.musl-${process.arch === "arm64" ? "aarch64" : "x86_64"}.so.1`, "libc.so.7", "libc.so"];

const symbols = {
  abs: { args: [FFIType.i32], returns: FFIType.i32 },
  strlen: { args: [FFIType.cstring], returns: FFIType.u64 },
  qsort: { args: [FFIType.ptr, FFIType.u64, FFIType.u64, FFIType.function], returns: FFIType.void },
  atof: { args: [FFIType.cstring], returns: FFIType.f64 },
  llabs: { args: [FFIType.i64], returns: FFIType.i64 },
} as const;

function open() {
  for (const name of names) {
    try {
      return dlopen(name, symbols);
    } catch {}
  }
  throw new Error("this platform's C library has another name");
}

const library = open();
console.log(library.symbols.abs(-5), Number(library.symbols.strlen(Buffer.from("hello\0"))), library.symbols.atof(Buffer.from("1.5\0")), String(library.symbols.llabs(-7n)));

const numbers = new Int32Array([5, 3, 9, 1]);
const compare = new JSCallback((a: Pointer, b: Pointer) => read.i32(a, 0) - read.i32(b, 0), { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 });
library.symbols.qsort(ptr(numbers), numbers.length, 4, compare.ptr!);
console.log(numbers.join(), typeof compare.ptr);
compare.close();

// A foreign function has the address of what it calls under `ptr`, which the declarations leave out.
const addressOfAbs = (library.symbols.abs as unknown as { ptr: Pointer }).ptr;
const linked = linkSymbols({ abs: { ptr: addressOfAbs, args: [FFIType.i32], returns: FFIType.i32 } });
console.log(linked.symbols.abs(-6));
const one = CFunction({ ptr: addressOfAbs, args: [FFIType.i32], returns: FFIType.i32 });
console.log(one(-8));

try {
  dlopen("no-such-library." + suffix, { f: { args: [], returns: FFIType.void } });
} catch (error) {
  console.log((error as Error).name, /no-such-library/.test((error as Error).message));
}

const bytes = new Uint8Array([1, 2, 3]);
console.log(typeof ptr(bytes), toBuffer(ptr(bytes), 0, 3).join());
library.close();
