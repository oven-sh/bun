// A CommonJS file defines a getter that is not enumerable and returns a member of a JSON file or of a built-in module. No loop over the exports sees the
// getter, so the namespace object of the file has no such name, also where a read of that name is all that the program does with the namespace.
import * as overJson from "./over-json.cjs";
import * as writtenOut from "./written-out.cjs";
import * as overBuiltIn from "./over-a-built-in-module.cjs";
import * as besideListed from "./beside-a-listed-getter.cjs";
import * as throughStar from "./star.mjs";
import * as listed from "./listed.cjs";
import { read } from "./reader.cjs";

console.log(overJson.x, writtenOut.x, overBuiltIn.sep, overBuiltIn.other, besideListed.x, besideListed.y);
console.log(throughStar.x, throughStar.y, listed.x, typeof overJson.x?.toFixed, read());
