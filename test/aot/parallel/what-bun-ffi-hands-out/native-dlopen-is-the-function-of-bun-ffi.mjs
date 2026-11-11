// `native.dlopen` is the function that Bun.FFI holds, not one that calls it.
import { native } from "bun:ffi";
console.log(`${native.dlopen === Bun.FFI.dlopen} ${typeof native.dlopen}`);
