// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

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

// GENERATED: _interopRequireDefault
// CHECK-LABEL: function {{*}}name="_interopRequireDefault"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected]}] results=[{type=undefined|null|number|string|symbol|bigint|[[L_1]]|[[L_2]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = ToBoolean v0
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b7(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v3 = PropGet v2 key="__esModule"
// CHECK-NEXT: v4 = ToBoolean v3
// CHECK-NEXT: Branch v4 -> taken b4(| 0), notTaken b6(| 0)
// CHECK-NEXT: b4(v5):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: Jump -> next b9(v2)
// CHECK-NEXT: b6(v6):
// CHECK-NEXT: Jump -> next b8(v2)
// CHECK-NEXT: b7(v7):
// CHECK-NEXT: Jump -> next b8(v7)
// CHECK-NEXT: b8(v8):
// CHECK-NEXT: v9 = NewObject -, v8 layout=[[L_2]] fields=[0]
// CHECK-NEXT: v10 = FinishObject v9
// CHECK-NEXT: Jump -> next b9(v10)
// CHECK-NEXT: b9(v11):
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|number|string|symbol|bigint|[[L_1]]|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
