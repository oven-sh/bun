// dlopen, linkSymbols, CFunction, JSCallback and viewSource run user getters and toString while they read a signature.
import { CFunction, dlopen, JSCallback, linkSymbols, viewSource } from "bun:ffi";

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

class Seen {
  constructor() {
    this.names = [];
  }
  add(name) {
    this.names.push(name);
    return this;
  }
  take() {
    const all = this.names.join();
    this.names.length = 0;
    return all;
  }
}
const seen = new Seen();
const text = (name, answer) => ({
  toString() {
    seen.add(name);
    return answer;
  },
});

const library = open({
  get abs() {
    seen.add("get abs");
    return {
      get args() {
        seen.add("args");
        return ["i32"];
      },
      get returns() {
        seen.add("returns");
        return text("returns.toString", "i32");
      },
      get threadsafe() {
        seen.add("threadsafe");
        return 0;
      },
      get ptr() {
        seen.add("ptr");
        return undefined;
      },
    };
  },
});
// Every libc name that open() tries reads the getters again, so only look at the last attempt.
console.log(seen.take().split(",").slice(-6).join(), String(library.symbols.abs(-4)));

try {
  dlopen(text("path", ""), { abs: {} });
} catch (error) {
  console.log(seen.take(), error.name);
}

const made = CFunction({
  get ptr() {
    seen.add("ptr");
    return library.symbols.abs.ptr;
  },
  args: ["i32"],
  returns: text("returns", "i32"),
});
console.log(seen.take(), String(made(-5)));

const linked = linkSymbols({
  a: { ptr: library.symbols.abs.ptr, args: [new String("i32")], returns: text("returns", "i32") },
});
console.log(seen.take(), String(linked.symbols.a(-6)));

const callback = new JSCallback(() => 1, {
  get returns() {
    seen.add("callback returns");
    return "i32";
  },
});
console.log(seen.take(), typeof callback.ptr);
callback.close();

console.log(typeof viewSource({ a: { returns: text("returns", "i32") } })[0], seen.take());
