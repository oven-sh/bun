// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3
// CHECK-LABEL: function {{*}}name="_interopRequireDefault"

// FILE: main.js
// What Babel emits for `import greet, * as lib from "./lib.js"` and `import plain from "./plain.js"`.
"use strict";

var _lib = _interopRequireWildcard(require("./lib.js"));
var _plain = _interopRequireDefault(require("./plain.js"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function _interopRequireWildcard(e, t) { if ("function" == typeof WeakMap) var r = new WeakMap(), n = new WeakMap(); return (_interopRequireWildcard = function (e, t) { if (!t && e && e.__esModule) return e; var o, i, f = { __proto__: null, default: e }; if (null === e || "object" != typeof e && "function" != typeof e) return f; if (o = t ? n : r) { if (o.has(e)) return o.get(e); o.set(e, f); } for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]); return f; })(e, t); }
console.log((0, _lib.default)(), _lib.name, (0, _plain.default)());

// FILE: lib.js
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = greet;
exports.name = void 0;
function greet() {
  return "hello";
}
const name = exports.name = "lib";

// FILE: plain.js
module.exports = function plain() {
  return "plain";
};

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
