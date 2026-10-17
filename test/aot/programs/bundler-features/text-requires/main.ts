// Files that are loaded as strings with `require()`.
declare const require: (specifier: string) => unknown
const text = require("./txt/hello.txt")
const note = require
console.log(typeof text, JSON.stringify(text), typeof note, JSON.stringify(note))
