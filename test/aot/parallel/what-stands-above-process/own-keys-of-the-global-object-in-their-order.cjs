// To load node:events adds no name to the global object: its own keys come in the order in which the program itself has read them.
require("node:events");
console.log(typeof navigator.userAgent);
delete globalThis.crypto;
const keys = Reflect.ownKeys(globalThis);
console.log(keys.indexOf("process") < keys.indexOf("navigator"));
