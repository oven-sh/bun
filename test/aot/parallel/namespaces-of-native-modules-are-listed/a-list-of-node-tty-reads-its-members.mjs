// node:tty is written in JavaScript. A list of the namespace asks each name for its descriptor, as in plain Bun.
import * as held from "node:tty";
console.log(Object.keys(held).sort().join());
const found = Object.getOwnPropertyDescriptor(held.default, "ReadStream");
console.log(typeof found.get, typeof found.value);
