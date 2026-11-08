// What `new JSCallback(..)` answers is a cell of native code that bun:ffi has laid below JSCallback.prototype.
import { JSCallback } from "bun:ffi";

const doubled = new JSCallback(value => value * 2, { args: ["i32"], returns: "i32" });
console.log(typeof doubled, typeof doubled.ptr, String(doubled.threadsafe));
console.log(String(doubled instanceof JSCallback), String(Object.getPrototypeOf(doubled) === JSCallback.prototype));
console.log(Object.getOwnPropertyNames(doubled).sort().join(), String(Object.keys(doubled).length));
console.log(String(+doubled === doubled.ptr), String(doubled.close === JSCallback.prototype.close));
doubled.close();
console.log(String(doubled.ptr), String(+doubled));
doubled.close();
console.log(String(doubled.ptr));
