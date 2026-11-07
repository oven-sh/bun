// A CommonJS file without `__esModule` defines a getter named `default`. Whoever imports the default of the file gets its whole exports: straight, through a
// module that hands the default on, and as `ns.default`. Whoever requires the file, and a getter of a file above it, gets what the getter returns.
import straight from "./over-a-module.cjs";
import handedOn from "./hands-on.mjs";
import { renamed, other } from "./hands-on-renamed.mjs";
import * as all from "./over-a-module.cjs";
import * as second from "./over-a-commonjs-file.cjs";
import ofVariable from "./hands-on-a-variable.mjs";
import above from "./above.cjs";
import { read } from "./reader.cjs";

console.log(JSON.stringify(straight), JSON.stringify(handedOn), JSON.stringify(renamed), other);
console.log(JSON.stringify(all.default), Object.keys(all), JSON.stringify(second.default), JSON.stringify(ofVariable));
console.log(JSON.stringify(above), JSON.stringify(read()));
