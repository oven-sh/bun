// A fresh Uint8Array passes a test that reads the type of the cell alone, and a Buffer reads it under its own names: what a Uint8Array is, it stays.
const lib = require("./lib.cjs");
const bytes = new Uint8Array(2);
bytes[0] = 72;
bytes[1] = 105;
console.log(lib.first(), lib.text(bytes));
