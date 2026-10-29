// A host constructor that answers with a string is constructed through a parameter.
const { CString, ptr } = require("bun:ffi");
function make(Class, argument) {
  return new Class(argument);
}
class Kept {
  constructor(value) {
    this.value = value;
  }
}
const bytes = Buffer.from("Hi\0");
const text = make(CString, ptr(bytes));
const kept = make(Kept, 1);
console.log(typeof text, text === "Hi", typeof text === "string" ? "a string" : "no string", typeof kept, kept.value);
