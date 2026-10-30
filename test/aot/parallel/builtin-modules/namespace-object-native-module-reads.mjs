// The loader fills the namespace object of a module that native code makes by reading each export off the module's object. One of node:module's is made at its first read, by a function of Bun that is written in JavaScript.
import * as nodeModule from "node:module";
const read = (object, name) => object[name];
console.log(typeof read(nodeModule, "wrapper"), typeof read(nodeModule, "_cache"), read(nodeModule, "_cache") === require.cache);
