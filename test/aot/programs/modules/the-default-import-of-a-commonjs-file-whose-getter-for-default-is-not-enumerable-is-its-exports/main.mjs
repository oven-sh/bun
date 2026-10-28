// A CommonJS file with `__esModule` defines `default` with a getter that is not enumerable. No loop over its exports sees the getter, so the default import
// is the whole exports. Whoever requires the file runs the getter.
import whole, { other } from "./lib.cjs";
import * as all from "./lib.cjs";
import overNoFlag from "./over-a-file-without-the-flag.cjs";
import { read } from "./reader.cjs";

console.log(JSON.stringify(whole), other, Object.keys(all), JSON.stringify(all.default), JSON.stringify(overNoFlag), read());
