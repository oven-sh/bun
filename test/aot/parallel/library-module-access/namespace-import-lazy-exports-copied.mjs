// The namespace object of node:fs is listed and copied.
import * as fs from "node:fs";
console.log(String(fs.existsSync(process.execPath)));
const copy = { ...fs };
console.log(
  Object.keys(fs).length === Object.keys(copy).length,
  typeof copy.promises.readFile,
  typeof copy.WriteStream,
  Object.entries(fs).find(entry => entry[0] === "Utf8Stream")?.[1]?.name,
);
