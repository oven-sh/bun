// A CommonJS file hands on the `default` of another CommonJS file with a getter, as compilers write `export { default } from`. The file below has no
// `__esModule`: whoever imports its default gets its whole exports, and the getter returns the member named `default`.
import whole from "./lib.cjs";
import * as all from "./lib.cjs";
import { taken } from "./renamed.cjs";
import byName from "./by-name.mjs";
import { taken as throughStar } from "./star.mjs";
import * as star from "./star.mjs";
import throughTwoGetters from "./outer.cjs";
import ofLiteral from "./over-a-literal.cjs";
import { taken as withoutFlagAbove } from "./without-the-flag.cjs";
import missing from "./over-a-file-without-the-member.cjs";
import below from "./inner.cjs";
import { read } from "./reader.cjs";
import count from "./over-a-counter.cjs";
import { change, readCount } from "./counter.cjs";
import greet from "./over-a-function.cjs";
import * as greeting from "./over-a-function.cjs";

console.log(whole, all.default, Object.keys(all), taken, byName, throughStar, Object.keys(star), star.taken);
console.log(throughTwoGetters, ofLiteral, withoutFlagAbove, missing, JSON.stringify(below), read());
console.log(count, readCount());
change();
console.log(count, readCount());
console.log(greet("a"), greeting.default("b"));
console.log(Object.keys(await import("./lib.cjs")), (await import("./lib.cjs")).default);
