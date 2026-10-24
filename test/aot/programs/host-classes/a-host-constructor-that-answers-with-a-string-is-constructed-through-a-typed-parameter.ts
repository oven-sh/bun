import { CString, ptr } from "bun:ffi";
const bytes = Buffer.from("Hi\0");
function make<T>(Class: new (at: number) => T, at: number): T {
  return new Class(at);
}
class Kept {
  length: number;
  constructor(value: number) {
    this.length = value;
  }
}
const text = make(CString as any, ptr(bytes)) as unknown;
const kept = make(Kept, 1);
console.log(typeof text, text === "Hi", typeof text === "string" ? "a string" : "no string", typeof kept, kept.length);
const direct: unknown = new CString(ptr(bytes));
console.log(typeof direct, direct === "Hi", typeof direct === "string" ? "a string" : "no string");
