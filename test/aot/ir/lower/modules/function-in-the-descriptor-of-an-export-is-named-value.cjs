// RUN: link
// CHECK: variable {{*}}name="plain"
// CHECK: function {{*}}name="value" {{*}}flags=[IsSloppy]
// CHECK: function {{*}}name="value" {{*}}kind=Arrow
// CHECK: function {{*}}name="value" {{*}}kind=BaseConstructor
// CHECK: function {{*}}name="kept" {{*}}HasExplicitName

// FILE: main.cjs
const { plain, arrow, made, own } = require("./defines.cjs");
console.log(plain, arrow, made, own);

// FILE: defines.cjs
Object.defineProperty(exports, "plain", { value: function () {} });
Object.defineProperty(exports, "arrow", { value: () => {} });
Object.defineProperty(exports, "made", { value: class {} });
Object.defineProperty(exports, "own", { value: function kept() {} });
