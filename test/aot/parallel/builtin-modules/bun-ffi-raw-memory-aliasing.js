// After ptr(view), the bytes can change through another view, read.*, CString or native code. Loads and stores on the original view must stay ordered with those.
import { CString, dlopen, ptr, read, toArrayBuffer, toBuffer } from "bun:ffi";

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

const library = open({
  memset: { args: ["usize", "i32", "usize"], returns: "usize" },
  memcpy: { args: ["ptr", "ptr", "usize"], returns: "ptr" },
});

function throughAnArrayBuffer() {
  const bytes = new Uint8Array(8);
  const other = new Uint8Array(toArrayBuffer(ptr(bytes), 0, 8));
  bytes[0] = 1;
  other[0] = 7;
  const first = bytes[0];
  other[1] = 9;
  return first * 100 + bytes[1] * 10 + bytes[2];
}

function throughABuffer() {
  const numbers = new Int32Array(4);
  const other = toBuffer(ptr(numbers), 0, 16);
  numbers[1] = 5;
  other.writeInt32LE(1234, 4);
  return numbers[1];
}

function storeThenRead(value) {
  const bytes = new Uint8Array(4);
  const address = ptr(bytes);
  bytes[2] = value;
  return read.u8(address, 2);
}

function storeThenString(value) {
  const bytes = new Uint8Array(4);
  const address = ptr(bytes);
  bytes[0] = value;
  bytes[1] = value + 1;
  return String(new CString(address));
}

function filledByNumber(value) {
  const bytes = new Uint8Array(8);
  const address = ptr(bytes);
  bytes[3] = 1;
  library.symbols.memset(address, value, 8);
  return bytes[3] + bytes[7];
}

function copied(value) {
  const from = new Uint8Array([value, value + 1, value + 2, value + 3]);
  const to = new Uint8Array(4);
  to[1] = 99;
  library.symbols.memcpy(to, from, 4);
  return to[1] * 10 + to[3];
}

const kept = new Uint8Array(8);
const addressOfKept = ptr(kept);
function fillKept(value) {
  library.symbols.memset(addressOfKept, value, 8);
}
function lookAtKept() {
  const before = kept[5];
  fillKept(before + 1);
  return kept[5];
}

for (let i = 0; i < 3; i++) {
  console.log(
    String(throughAnArrayBuffer()),
    String(throughABuffer()),
    String(storeThenRead(3 + i)),
    storeThenString(65 + i),
    String(filledByNumber(2 + i)),
    String(copied(1 + i)),
    String(lookAtKept()),
  );
}
