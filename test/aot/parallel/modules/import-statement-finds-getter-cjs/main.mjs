// A CommonJS file defines a getter that is not enumerable and returns a name of a second file, and import statements name it: of the file itself,
// through `export *`, with `enumerable: false` written out, beside a default import whose object the program looks at, over a name that the second file
// stores under a condition, and over a variable of an ES module that changes later.
// Reference: bun build --compile
import { x } from "./lib.cjs";
import { x as throughStar } from "./star.mjs";
import { x as writtenOut } from "./written-out.cjs";
import whole, { x as besideTheDefault } from "./whole.cjs";
import { held } from "./over-a-store-under-a-condition.cjs";
import * as seen from "./over-a-store-under-a-condition.cjs";
import { count } from "./over-a-variable.cjs";
import { change } from "./counter.mjs";

console.log(x, throughStar, writtenOut, besideTheDefault, Object.keys(whole).join(), whole.x);
console.log(held, Object.keys(seen).includes("default"), count);
change();
console.log(count);
