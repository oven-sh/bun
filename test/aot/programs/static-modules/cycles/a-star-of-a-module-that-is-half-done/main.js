// TypeScript's `export * from "./late"` runs while `late` is half done: the loop of the helper finds the names that are stored so far and no others. The name it found stays live, the name it missed never appears.
const late = require("./late");
const index = require("./index");
console.log(late.keysOfIndex(), index.early, index.late);
