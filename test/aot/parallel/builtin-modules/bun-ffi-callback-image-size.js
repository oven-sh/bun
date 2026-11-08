// JSCallback, CFunction and linkSymbols must not pull util.inspect into the executable.
// STATISTIC: ImageFunctionsEmitted <= 100
import { CFunction, JSCallback, linkSymbols } from "bun:ffi";

const callback = new JSCallback(value => value * 2 + 1, { args: ["i32"], returns: "i32" });
const call = CFunction({ ptr: callback.ptr, args: ["i32"], returns: "i32" });
const linked = linkSymbols({ twice: { ptr: callback.ptr, args: ["i32"], returns: "i32" } });
console.log(String(call(20)), String(linked.symbols.twice(3)), typeof callback.ptr);
linked.close();
callback.close();
console.log(String(callback.ptr));
