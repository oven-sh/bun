// The printer of objects is handed what native code has made.
import { CFunction, JSCallback, linkSymbols } from "bun:ffi";

const kept = new JSCallback(value => value, { args: ["i32"], returns: "i32" });
const linked = linkSymbols({ same: { ptr: kept.ptr, args: ["i32"], returns: "i32" } });
const enter = CFunction({ ptr: kept.ptr, args: ["i32"], returns: "i32" });
console.log(linked.symbols);
console.log(enter.name.length > 0 ? [enter.native === enter] : []);
linked.close();
kept.close();
console.log(kept);
console.log({ address: kept.ptr, safe: kept.threadsafe });
