// Negative zero, NaN, large and small numbers, texts outside Latin-1 and big integers arrive as they are.
import { negativeZero, notANumber, infinite, large, small, fraction, wide, empty, bigNegative, joined } from "./values.js";
import * as values from "./values.js";
console.log(Object.is(negativeZero, -0), 1 / negativeZero, Object.is(notANumber, NaN), notANumber === notANumber, infinite, large, small, fraction);
console.log(wide, wide.length, JSON.stringify(empty), bigNegative, typeof bigNegative, joined);
console.log(Object.is(values.negativeZero, -0), values.notANumber !== values.notANumber, values.wide + values.joined);
if (negativeZero) console.log("never");
if (notANumber) console.log("never");
if (empty) console.log("never");
if (!wide) console.log("never");
if (!bigNegative) console.log("never");
