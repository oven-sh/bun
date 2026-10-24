const { CString, ptr } = require("bun:ffi");
const bytes = Buffer.from("Hi\0");
const text = new CString(ptr(bytes));
const map = new Map([["Hi", 1]]);
const record = { Hi: 2 };
console.log(map.get(text), record[text], text + "!", `${text}`, text.length, text.toUpperCase(), JSON.stringify({ text }), new Set([text, "Hi"]).size);
console.log(Object(text) === text, text instanceof CString, text instanceof String);
switch (text) {
  case "Hi":
    console.log("the case of the string");
    break;
  default:
    console.log("the default");
}
