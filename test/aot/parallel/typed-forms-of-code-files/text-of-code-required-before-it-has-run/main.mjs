// A require() that runs before an imported text has evaluated gets the code of the file, and import() gives that same module.
import * as text from "./ladder.mjs" with { type: "text" };
import * as bare from "./bucket.mjs" with { type: "text" };
import asked from "./ask.cjs";
import { first } from "./first.mjs";
const ladder = await import("./ladder.mjs");
console.log(Object.keys(text).join(), Object.keys(asked.ladder).join(), ladder.rungs, globalThis.climbed);
console.log(Object.keys(bare).join(), typeof bare.default, Object.keys(asked.bucket).length, globalThis.filled);
console.log(first.rungs === ladder.rungs, text.default.includes("rungs"));
