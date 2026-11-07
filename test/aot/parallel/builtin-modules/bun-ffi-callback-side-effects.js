// A JSCallback runs during a native call, so its stores must be visible when the call returns. Arguments and callback results go through valueOf and Symbol.toPrimitive.
import { CFunction, dlopen, JSCallback } from "bun:ffi";

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

const library = open({ qsort: { args: ["ptr", "usize", "usize", "function"], returns: "void" } });

const state = { calls: 0, kind: "" };
class Counter {
  constructor() {
    this.count = 0;
  }
  bump() {
    this.count += 1;
    return this.count;
  }
}
const counter = new Counter();
const compare = new JSCallback(
  (left, right) => {
    state.calls += 1;
    counter.bump();
    state.kind = typeof left + " " + typeof right;
    return 0;
  },
  { args: ["ptr", "ptr"], returns: "i32" },
);

function sort() {
  const calls = state.calls;
  const count = counter.count;
  library.symbols.qsort(new Int32Array([3, 1, 2]), 3, 4, compare);
  const entered = state.calls > calls ? "entered" : "not entered";
  const counted = counter.count > count ? "counted" : "not counted";
  return entered + " " + counted + " " + state.kind;
}
console.log(sort());
console.log(sort());
compare.close();

const log = [];
class Answer {
  constructor(value) {
    this.value = value;
  }
  valueOf() {
    log.push("valueOf " + this.value);
    return this.value;
  }
}
class Argument {
  constructor(value) {
    this.value = value;
  }
  [Symbol.toPrimitive]() {
    log.push("toPrimitive " + this.value);
    return this.value;
  }
}
const doubles = new JSCallback(value => new Answer(value * 2), { args: ["i32"], returns: "i32" });
const call = CFunction({ ptr: doubles.ptr, args: ["i32"], returns: "i32" });
console.log(String(call(21)), log.join());
console.log(String(call(new Argument(4))), log.join());
doubles.close();
