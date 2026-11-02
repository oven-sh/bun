// node:stream binds two functions of Promise that it finds under names of its own. The program reads neither, so Promise adds them where it would without the module.
// Alone: the order of the keys of a built-in object follows from which members were read first, and the other entry points of a joined executable read some
import { Readable } from "node:stream";
console.log(typeof Readable, typeof Promise.any);
Object.entries(Promise);
console.log(Reflect.ownKeys(Promise).map(String).join());
console.log(
  Promise.reject === Promise["rej" + (Date.now() < 5 ? "x" : "ect")],
  Object.getOwnPropertyDescriptor(Promise, "resolve").value === Promise.resolve,
);
