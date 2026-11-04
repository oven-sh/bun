// RUN: link
// CHECK: layout {{*}}fields=[{key="__esModule" declared={type=anything} form=[IsReadOnly, IsNotEnumerable, IsNotConfigurable]}, {key="A" declared={type=anything}}, {key="B" declared={type=anything}}, {key="f" declared={type=anything}}, {key="getter" declared={type=anything} form=[IsNotConfigurable, IsAccessor]}, {key="viaModule" declared={type=anything}}, {key="viaThis" declared={type=anything}}, {key="late" declared={type=anything}}]

// RUN(ABSENT): link
// ABSENT-NOT: layout {{*}}key="ofParameter"
// ABSENT-NOT: layout {{*}}key="0"
// ABSENT-NOT: layout {{*}}key="unknownForm"

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.B = exports.A = void 0;
exports.f = f;
function f() {
  exports.late = 1;
}
Object.defineProperty(exports, "getter", { enumerable: true, get: function () { return exports.A; } });
module.exports.viaModule = 2;
this.viaThis = 3;
exports.A = 4;
exports[0] = 5;
Object.defineProperty(exports, "unknownForm", f());
(function (exports) {
  exports.ofParameter = 6;
})({});
