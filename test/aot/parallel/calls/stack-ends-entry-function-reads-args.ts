// A recursion runs to the end of the stack, and each catch on the way up calls a small function that calls a function of a library module.
// That function asks how many arguments it was given, so it is entered with its arguments on the stack. Where there is no room for its frame it throws at its entry.
// Its caller has a frame of one word. The stack of the error and the handler that catches it are both looked for from there.
// Flags: --aot-limit=MaxWarmCodeValues:1
const strange: string[] = [];
let thrownAtTheEnd = 0;

function compares() {
  return typeof require("node:assert").deepStrictEqual({ a: [1] }, { a: [1] });
}

function atTheEnd() {
  try {
    if (compares() !== "undefined") strange.push("a comparison returned something");
  } catch (error) {
    if (error instanceof RangeError && typeof error.stack === "string") thrownAtTheEnd++;
    else strange.push(String(error));
  }
}

function down(level: number): number {
  let text = "";
  for (let at = 0; at < 3; at++) text += level;
  let below = 0;
  try {
    below = (() => down(level + 1))();
  } catch (error) {
    atTheEnd();
  }
  return below + text.length - String(level).length * 3;
}

console.log(compares());
for (let round = 0; round < 3; round++) console.log(down(0));
// On Windows x64 every one of those calls finds room.
const mayFindRoom = process.platform === "win32" && process.arch === "x64";
console.log(thrownAtTheEnd > 0 || mayFindRoom, strange.length ? strange[0] : "nothing strange");

export {};
