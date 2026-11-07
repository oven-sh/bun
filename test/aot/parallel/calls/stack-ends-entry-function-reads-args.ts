// A recursion runs to the end of the stack. On the way up each of a hundred catches goes down again in small steps, each of which calls a small function that calls a function of a library module.
// That function asks how many arguments it was given. Where there is no room for it the call throws, and the stack of the error and the handler that catches it are both looked for from its caller.
// A step is as small as a frame gets, so at one of them there is room for the caller and none for the function, however large the frames of the recursion are and however little room its last catch finds.
// That takes a caller that makes no test of the stack for itself: on arm64 a call pushes nothing, so behind such a test the call finds the room that the caller found.
// A small function goes untested while few frames are counted below it, so nobody may know whom this one calls: the name of the function comes out of a text.
const strange: string[] = [];
const stacks: string[] = [];
let levelsClimbed = 0;
const compared = require("node:assert")[JSON.parse('"deepStrictEqual"')];

function compares() {
  return typeof compared({ a: [1] }, { a: [1] });
}

function atTheEnd() {
  try {
    if (compares() !== "undefined") strange.push("a comparison returned something");
  } catch (error) {
    if (error instanceof RangeError && typeof error.stack === "string") stacks.push(error.stack);
    else strange.push(String(error));
  }
}

function creeps(): void {
  atTheEnd();
  creeps();
}

function down(level: number): number {
  let text = "";
  for (let at = 0; at < 3; at++) text += level;
  let below = 0;
  try {
    below = (() => down(level + 1))();
  } catch (error) {
    try {
      creeps();
    } catch {}
    if (++levelsClimbed < 100) throw error;
  }
  return below + text.length - String(level).length * 3;
}

console.log(compares());
for (let round = 0; round < 3; round++) {
  levelsClimbed = 0;
  console.log(down(0));
}
// An error that a function throws for want of room for its own frame names whoever called it first, so these are the calls that found none.
const thrownAtTheCall = stacks.filter(stack => stack.split("\n")[1].trimStart().startsWith(`at ${compares.name} `)).length;
// On Windows x64 every one of those calls finds room.
const mayFindRoom = process.platform === "win32" && process.arch === "x64";
console.log(thrownAtTheCall > 0 || mayFindRoom, strange.length ? strange[0] : "nothing strange");

export {};
