// A `require` that another file exports resolves paths from that file's folder, not from the folder of the file that calls it.
import { __require as first } from "./first/chunk.mjs";
import { __require as second } from "./second/chunk.mjs";
const lastParts = (path, count) => path.split(/[\\/]/).slice(-count).join("/");
console.log(first("./inside.cjs"), "|", second("./inside.cjs"), "|", require("./inside.cjs"));
console.log(lastParts(first.resolve("./inside.cjs"), 2), lastParts(second.resolve("./inside.cjs"), 2));
for (const name of ["a", "b"]) console.log(first("./parts/" + name + ".cjs"));
for (const name of ["./missing.cjs", "./parts/" + process.argv.length + ".cjs", "missing-package"]) {
  try {
    first(name);
  } catch (error) {
    const lines = error.message.split("\n");
    console.log(error.code, lines[0], lastParts(lines.at(-1), 2));
  }
}
try {
  second("./missing.cjs");
} catch (error) {
  console.log(error.code, lastParts(error.message.split("\n").at(-1), 2));
}
