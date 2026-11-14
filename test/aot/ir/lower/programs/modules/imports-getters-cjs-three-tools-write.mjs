// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 7
// CHECK-LABEL: function {{*}}name="show"

// FILE: main.mjs
// The getters as TypeScript, Babel and swc write them, over a function that its module replaces later, and a getter over an ES module that hands on a
// name which it imported through another getter.
import { greet as typescript } from "./typescript.cjs";
import { greet as babel } from "./babel.cjs";
import { greet as swc } from "./swc.cjs";
import { greet as above, read } from "./above.cjs";
import { change } from "./greeting.mjs";

function show() {
  console.log(typescript(), babel(), swc(), above(), read()());
}
show();
change();
show();

// FILE: above.cjs
var below_1 = require("./between.mjs");
Object.defineProperty(exports, "greet", { enumerable: true, get: function () { return below_1.greet; } });
exports.read = function () {
  return below_1.greet;
};

// FILE: babel.cjs
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
Object.defineProperty(exports, "greet", {
  enumerable: true,
  get: function () {
    return _greeting.greet;
  }
});
var _greeting = require("./greeting.mjs");

// FILE: between.mjs
export { greet } from "./typescript.cjs";

// FILE: greeting.mjs
export let greet = function () {
  return "first";
};
export function change() {
  greet = function () {
    return "second";
  };
}

// FILE: swc.cjs
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "greet", {
    enumerable: true,
    get: function() {
        return _greeting.greet;
    }
});
const _greeting = require("./greeting.mjs");

// FILE: typescript.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.greet = void 0;
var greeting_mjs_1 = require("./greeting.mjs");
Object.defineProperty(exports, "greet", { enumerable: true, get: function () { return greeting_mjs_1.greet; } });

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
