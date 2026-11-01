// util.isDeepStrictEqual(): the first value has a hidden `constructor` of its own, so the prototypes are compared.
import { isDeepStrictEqual } from "node:util";
class Other {}
const shape = a => ({ a });
const first = shape(1);
Object.defineProperty(first, "constructor", { value: Other, enumerable: false });
console.log(isDeepStrictEqual(first, shape(1)));
