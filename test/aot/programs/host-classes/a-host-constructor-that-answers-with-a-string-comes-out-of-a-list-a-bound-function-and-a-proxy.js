const ffi = require("bun:ffi");
const bytes = Buffer.from("Hi\0");
const found = Object.values(ffi).filter(value => typeof value === "function" && value.name === "CString");
const Bound = ffi.CString.bind(null);
const Wrapped = new Proxy(ffi.CString, {});
for (const Class of [found[0], Bound, Wrapped]) {
  const text = new Class(ffi.ptr(bytes));
  console.log(typeof text, text === "Hi", typeof text === "string" ? "a string" : "no string");
}
console.log(typeof Reflect.construct(ffi.CString, [ffi.ptr(bytes)]), typeof ffi.CString(ffi.ptr(bytes)));
