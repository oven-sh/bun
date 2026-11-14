// dlopen(..) answers a library whose functions take and answer numbers alone.
import { dlopen, ptr } from "bun:ffi";

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
  abs: { args: ["i32"], returns: "i32" },
  strlen: { args: ["ptr"], returns: "u64" },
  toupper: { args: ["i32"], returns: "i32" },
});
console.log(Object.keys(library.symbols).join(), typeof library.close, typeof library.symbols.abs.ptr);
console.log(
  String(library.symbols.abs(-41)),
  typeof library.symbols.strlen(ptr(new Uint8Array([1, 1, 1, 0]))),
  String(library.symbols.strlen(ptr(new Uint8Array([1, 1, 1, 0])))),
);
console.log(
  String.fromCharCode(library.symbols.toupper(113)),
  String(library.symbols.abs.native === library.symbols.abs),
);
const { close } = library;
close();
