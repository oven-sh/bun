// Names of commonjs files are handed on by files that nobody takes them from.
import { x as guardedAgain } from "./guarded/again.mjs";
import { K as guarded } from "./guarded/lib.cjs";
import { x as loadedAgain } from "./loaded/again.mjs";
import { x as wrappedAgain } from "./wrapped/again.mjs";
import * as wrapped from "./wrapped/lib.cjs";
import { x as replacedAgain } from "./replaced/again.mjs";
import replaced from "./replaced/lib.cjs";
import { x as definedAgain } from "./defined/again.mjs";
import { x as rowAgain } from "./row/again.mjs";
import { K as row } from "./row/lib.cjs";
import { x as effectsAgain } from "./effects/between.mjs";
import { K as effects } from "./effects/lib.cjs";
import { x as halfAgain, y as otherHalf } from "./half/again.mjs";
import { K as half } from "./half/lib.cjs";
import { K as starAgain } from "./star/again.mjs";
import * as star from "./star/lib.cjs";
import { x as wholeAgain } from "./whole/again.mjs";
import { K as whole } from "./whole/lib.cjs";

function describe(error) {
  return error.name + ": " + String(error.message).replace(/[^\s'"]*[\\/]/g, "");
}

console.log(guarded);
console.log((await import("./loaded/lib.cjs")).K);
console.log(wrapped.K, Object.keys(wrapped).join());
console.log(JSON.stringify(replaced));
console.log(require("./defined/lib.cjs").K);
console.log(row);
console.log(effects);
console.log(half, otherHalf);
console.log((await import("./below/asked.mjs")).value);
console.log(starAgain, star.K);
console.log(whole);

try {
  await import("./missing/asked.mjs");
} catch (error) {
  console.log(describe(error));
}
try {
  require("./required/asked.mjs");
} catch (error) {
  console.log(describe(error));
}
try {
  await import("./starred/asked.mjs");
} catch (error) {
  console.log(describe(error));
}
try {
  await import("./absent/asked.mjs");
} catch (error) {
  console.log(describe(error));
}
