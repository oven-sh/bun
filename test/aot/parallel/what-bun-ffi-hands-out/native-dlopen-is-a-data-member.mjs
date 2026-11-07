// `native.dlopen` of bun:ffi is a data member that can be written, and it prints as a function.
// Todo: in an executable `native.dlopen` of bun:ffi is an accessor where plain Bun has a data member: nothing that loads machine code is read while the module loads
import { native } from "bun:ffi";
import { inspect } from "node:util";
const found = Object.getOwnPropertyDescriptor(native, "dlopen");
console.log(`SAID ${typeof found.value} ${typeof found.get} ${found.writable} ${found.enumerable} ${found.configurable}`);
console.log(inspect({ dlopen: native.dlopen }) === inspect({ dlopen: found.value }), /Getter/.test(inspect(native)));
