// A path that is a string somewhere in the program finds its file. The call gets the same path out of bytes.
globalThis.pathsOfThisProgram = ["./n.mjs"];
const name = Buffer.from("2e2f6e2e6d6a73", "hex").toString();
let said;
try {
  said = "n gave " + import.meta.require(name).read();
} catch (error) {
  said = "require throws " + error.name;
}
console.log("m:", said);
export const late = { x: process.argv.length };
export function seen() {
  return late.x > 0;
}
