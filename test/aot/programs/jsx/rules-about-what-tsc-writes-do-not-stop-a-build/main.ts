// The project sets no "jsx", "module": "esnext", an old target and "importHelpers" without tslib. tsc refuses the import of a .tsx file (TS6142), each tag (TS17004), `import = require` (TS1202), `export =` (TS1203) and the rest element (TS2354): rules about what tsc would write. Plain Bun runs the program, and so does a build.
import api = require("./lay");
import { view } from "./view";
function others(o: { a: number; b: number; c: number }) { const { a, ...rest } = o; return rest; }
console.log(api(), view, others({ a: 1, b: 2, c: 3 }));
