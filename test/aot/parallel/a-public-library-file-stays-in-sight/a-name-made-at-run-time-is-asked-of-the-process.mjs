// See a-name-made-at-run-time-is-required.cjs. `posix` is the object of the file itself where paths are POSIX paths.
import { posix, win32 } from "node:path";
const same = process.getBuiltinModule(Buffer.from("6e6f64653a70617468", "hex").toString());
same.join = function () { return "changed"; };
console.log((same === posix ? posix : win32).join("a", "b"), same === posix || same === win32);
