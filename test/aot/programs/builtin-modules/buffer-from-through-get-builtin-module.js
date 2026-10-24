// Buffer.from is written in JavaScript. This program names it only through process.getBuiltinModule.
console.log(process.getBuiltinModule("node:buffer").Buffer.from("abc").length);
