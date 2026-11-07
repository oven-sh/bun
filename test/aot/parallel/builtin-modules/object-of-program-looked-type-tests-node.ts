// An object of the program is only looked at by the type tests of node.
import { types } from "node:util";
import { isUtf8 } from "node:buffer";
class Mine { a = 1; }
const mine = new Mine();
console.log(types.isDate(mine), types.isPromise(mine), types.isProxy(mine), types.isMap(new Map()), types.isTypedArray(mine), mine.a);
console.log(isUtf8(new Uint8Array([97])), AbortSignal.any([new AbortController().signal]).aborted, typeof AbortSignal.timeout(1000).aborted);
process.exit(0);
