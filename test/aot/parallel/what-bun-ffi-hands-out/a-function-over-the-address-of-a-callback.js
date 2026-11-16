// What CFunction(..) answers is a function of native code with two properties of its own, and bun:ffi stores a third.
import { CFunction, JSCallback } from "bun:ffi";

const tripled = new JSCallback(value => value * 3, { args: ["i32"], returns: "i32" });
const enter = CFunction({ ptr: tripled.ptr, args: ["i32"], returns: "i32" });
console.log(typeof enter, String(enter.length), String(enter.name.startsWith("CFunction")));
console.log(String(enter.ptr === tripled.ptr), String(enter.native === enter), typeof enter.close);
console.log(String(enter(14)), String(enter.call(undefined, 2)), String(Reflect.apply(enter, null, [3])));
console.log(String(Object.getPrototypeOf(enter) === Function.prototype), String(enter instanceof Function));
enter.close();
tripled.close();
