/// <reference path="./globals.d.ts" />
// Under `bun run` the class and the enum of this file are variables of the file, and no global `Level` has the members that the declaration file lists.
class Held {
  own = 1;
}
enum Level {
  Own = 4,
}
function show(level: Level): string {
  return level + " " + Level[level];
}
console.log(new Held().own, new Held().declared, show(Level.Own), show(3));
