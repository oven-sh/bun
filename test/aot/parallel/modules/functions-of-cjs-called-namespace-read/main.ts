// A CommonJS file stores functions that read and call other exports of the file through `this`. A module imports the namespace of the file and
// only ever calls through it.
import * as file from "./file.cjs";

console.log(file.readsAnother());
console.log(file.callsAnother());
console.log(file.listsAll());
