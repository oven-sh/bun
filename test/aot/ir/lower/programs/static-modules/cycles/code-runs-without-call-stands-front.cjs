// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3
// CHECK-LABEL: function {{*}}name="get"

// FILE: main.cjs
// An accessor of a global and a conversion to a string run code in front of the statement that gives the module its `__esModule`, and no call is written there: whoever they run finds no marker.
Object.defineProperty(globalThis, "peek", {
  get() {
    const m = require("./read.cjs");
    console.log("early", m.__esModule, m.a);
    return 1;
  },
});
globalThis.text = {
  toString() {
    const m = require("./converted.cjs");
    console.log("early", m.__esModule, m.a);
    return "text";
  },
};
const first = require("./read.cjs");
console.log("late", first.__esModule, first.a);
const second = require("./converted.cjs");
console.log("late", second.__esModule, second.a);

// FILE: converted.cjs
var seen = `${globalThis.text}`;
Object.defineProperty(exports, "__esModule", { value: true });
exports.a = seen;

// FILE: read.cjs
var seen = globalThis.peek;
Object.defineProperty(exports, "__esModule", { value: true });
exports.a = seen;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
