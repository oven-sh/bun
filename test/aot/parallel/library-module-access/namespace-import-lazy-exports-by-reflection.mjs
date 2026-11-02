// Asking a namespace object whether it has an own property reads the export.
import * as fs from "node:fs";
console.log(String(fs.existsSync(process.execPath)));
console.log(
  Object.prototype.hasOwnProperty.call(fs, "Utf8Stream"),
  "promises" in fs,
  typeof Reflect.get(fs, "promises").readFile,
  Object.keys(Object.getOwnPropertyDescriptor(fs, "ReadStream")).join(),
  typeof Object.getOwnPropertyDescriptor(fs, "WriteStream").value,
);
