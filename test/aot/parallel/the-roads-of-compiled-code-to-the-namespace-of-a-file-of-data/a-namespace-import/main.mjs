// Compiled code comes by the namespace of a file of data through `import *`: the file keeps every name, though another file reads one alone.
import { one } from "./reads-one-name.mjs";
import * as got from "./rows.json";
console.log(one, String(got.b), "b" in got, Object.keys(got).sort().join());
