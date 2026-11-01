// An addon that is opened with RTLD_DEEPBIND sets the default action for SIGSEGV. Compiled code finds a read of null by that signal.
const { RTLD_LAZY, RTLD_DEEPBIND } = require("node:os").constants.dlopen;
class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
}
// The build cannot tell which two of the four are called, and they are handed objects too: a read of theirs stays a load.
const all: ((point: any) => number)[] = [
  (point: Point | null) => point!.x,
  (point: Point | null) => point!.x + 1,
  (point: Point | null) => point!.x * point!.y,
  (point: Point | null) => point!.y - 1,
];
const first = process.argv.length > 100 ? 2 : 0;
const readers = [all[first], all[first + 1]];
const none = JSON.parse("null");
for (let i = 0; i < 1000; i++) readers[i & 1](new Point(i, i));

const core: { exports: any } = { exports: {} };
process.dlopen(core, process.env.CORE!, RTLD_LAZY | RTLD_DEEPBIND);
console.log("signal() of the addon is the program's own:", core.exports.signalIsTheProgramsOwn());
core.exports.setDefaultAction(11);
let caught = 0;
for (let i = 0; i < 10; i++) {
  try {
    readers[i & 1](none);
  } catch (error) {
    if (error instanceof TypeError) caught++;
  }
}
console.log("reads of null that threw a TypeError:", caught);
