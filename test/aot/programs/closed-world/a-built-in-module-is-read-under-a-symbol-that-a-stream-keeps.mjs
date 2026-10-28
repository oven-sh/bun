// A stream of node:fs keeps the module under a symbol. The program lists the stream's symbols, reads the module under that symbol and calls three of its functions:
// one that it also calls by name, one that it names only here, and one whose name is made at run time and that nothing else in the program calls.
import { createReadStream, existsSync } from "node:fs";

function outcome(error) {
  const message = String(error.message);
  return message.includes("bun compile differs from bun run here")
    ? "refused: " + message.replace(/'.*?'/, "'..'")
    : error.code;
}

const stream = createReadStream(process.execPath, { end: 0 });
const symbols = Object.getOwnPropertySymbols(stream).filter(symbol => symbol.description === "kFs");
console.log("symbols with that description:", symbols.length);

const held = stream[symbols[0]];
console.log(
  "what lies under it:",
  typeof held,
  held.createReadStream === createReadStream,
  held.existsSync === existsSync,
);
console.log("its members:", typeof held.lutimesSync, held.lutimesSync.name, "lutimesSync" in held);
console.log(
  "a function that the program also calls by name:",
  held.existsSync(process.execPath),
  existsSync(process.execPath),
);
for (const [label, call] of [
  ["a function that is named only here", () => held.lutimesSync("/no/such/folder/file", 0, 0)],
  [
    "a function under a name made at run time",
    () => held[Buffer.from("lchownSync").toString()]("/no/such/folder/file", 0, 0),
  ],
]) {
  try {
    console.log(label + ":", call());
  } catch (error) {
    console.log(label + ":", outcome(error));
  }
}
stream.destroy();
