// RUN: lower
// OPTIONS: builtin-modules

// The same in a CommonJS file, where the helpers are locals of the module's function and the wrappers capture them.
"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) =>
  function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

var require_late_user = __commonJS({
  "late-user.js"(exports2) {
    exports2.value = require_late().value + 1;
  },
});

var require_late = __commonJS({
  "late.js"(exports2, module2) {
    module2.exports = { value: 41 };
  },
});

var require_class = __commonJS({
  "class.js"(exports2, module2) {
    module2.exports = class Box {
      constructor(value) {
        this.value = value;
      }
      get() {
        return this.value;
      }
    };
  },
});

var require_function = __commonJS({
  "function.js"(exports2, module2) {
    module2.exports = function twice(value) {
      return value * 2;
    };
    module2.exports.default = module2.exports;
  },
});

var Box = require_class();
module.exports = { answer: require_late_user().value, box: new Box(7).get(), twice: require_function().default(21) };
console.log(JSON.stringify(module.exports), require_class() === Box, require_late().value);

// GENERATED: late-user.js class.js __commonJS Box __require
// CHECK-LABEL: function {{*}}name="late-user.js"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=CommonJsModule flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Boolean boolean=true
// CHECK-NEXT: EvaluateModule module=[[m_1]] referrer=[[m_2]] [isBare]
// CHECK-NEXT: v2 = Boolean boolean=true
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v4 = Integer integer=1
// CHECK-NEXT: v5 = Add v3, v4
// CHECK-NEXT: PutModuleVariable v5 variable=[[g_4]]
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="class.js"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=CommonJsModule flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewObject layout=[[L_5]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_6]]
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: v4 = NewClosure function=[[f_7]]
// CHECK-NEXT: v5 = NewClass v4 layout=[[L_8]]
// CHECK-NEXT: v6 = NewClosure function=[[f_9]]
// CHECK-NEXT: DefineMethod v5, v6 layout=[[L_8]] key="get"
// CHECK-NEXT: v8 = FinishClass v5 layout=[[L_8]]
// CHECK-NEXT: v9 = Convert v8 declared={type=[[f_7]] flags=[IsFromCompiler]}
// CHECK-NEXT: PutModuleVariable v8 variable=[[g_6]]
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="__commonJS"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}, {type=undefined|null|[[L_10]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|object, v1: undefined|null|[[L_10]]):
// CHECK-NEXT: v2 = NewObject -, v1 layout=[[L_11]] fields=[0]
// CHECK-NEXT: v3 = NewClosure v2, v0 function=[[f_12]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Box"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_8]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_8]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_8]]}
// CHECK-NEXT: PropSet v4, v1 key="value"
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: v7 = TypeTest v6 testedType=object
// CHECK-NEXT: Branch v7 -> taken b1(| 0), notTaken b2(v4)
// CHECK-NEXT: b1(v8):
// CHECK-NEXT: Jump -> next b2(v8)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="__require"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] captures=[{type=env [[L_11]] flags=[IsFromCompiler]}, {type=undefined|null|object flags=[IsExpected] variableName="cb"}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_11]], v1: undefined|null|object):
// CHECK-NEXT: v2 = GetEnvironmentField v0 layout=[[L_11]]
// CHECK-NEXT: v3 = ToBoolean v2
// CHECK-NEXT: Branch v3 -> taken b2(), notTaken b1(| 0)
// CHECK-NEXT: b1(v4):
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_14]]
// CHECK-NEXT: v6 = Call v5, -, v1 calleeName="__getOwnPropNames"
// CHECK-NEXT: v7 = Integer
// CHECK-NEXT: v8 = ElemGet v6, v7
// CHECK-NEXT: v9 = ElemGet v1, v8
// CHECK-NEXT: v10 = Data data=[[d_15]]
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[L_10]] flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v0, v11 layout=[[L_11]]
// CHECK-NEXT: v13 = PropGet v10 key="exports"
// CHECK-NEXT: v14 = GetEnvironmentField v0 layout=[[L_11]]
// CHECK-NEXT: v15 = Call v9, -, v13, v14
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: v16 = GetEnvironmentField v0 layout=[[L_11]]
// CHECK-NEXT: v17 = PropGet v16 key="exports"
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
