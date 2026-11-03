// A field of what a parameter constructs is read and a host constructor answers with a string.
const { CString, ptr } = require("bun:ffi");
function make(Class, argument) {
  return new Class(argument);
}
class Kept {
  constructor(value) {
    this.length = value;
  }
}
const bytes = Buffer.from("Hi\0");
console.log(make(CString, ptr(bytes)).length, make(Kept, 5).length);
console.log(make(Bun.FFI.CString, ptr(bytes)).length, make(Kept, 6).length);
