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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Boolean boolean=true
// CHECK-NEXT: EvaluateModule module=[[m_1]] referrer=[[m_2]] [isBare]
// CHECK-NEXT: v2 = Boolean boolean=true
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v5 = Integer integer=1
// CHECK-NEXT: v6 = Add v4, v5
// CHECK-NEXT: PutModuleVariable v6 variable=[[g_4]]
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="class.js"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=CommonJsModule flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewObject layout=[[L_5]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_6]]
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: v4 = NewClosure function=[[f_7]]
// CHECK-NEXT: v5 = NewClass v4 layout=[[L_8]]
// CHECK-NEXT: v6 = NewClosure function=[[f_9]]
// CHECK-NEXT: DefineMethod v5, v6 layout=[[L_8]] key="get"
// CHECK-NEXT: v8 = FinishClass v5 layout=[[L_8]]
// CHECK-NEXT: v9 = Convert v8 declared={type=[[f_7]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: PutModuleVariable v8 variable=[[g_6]]
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="__commonJS"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 captures=[{type=undefined|null|[[f_10]]|builtin(ObjectGetOwnPropertyNames) flags=[IsExpected]}] thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}, {type=undefined|null|[[L_11]] flags=[IsExpected]}] results=[{type=undefined|null|[[f_12]] flags=[IsExpected]}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_10]]|builtin(ObjectGetOwnPropertyNames), v1: undefined|null|object, v2: undefined|null|[[L_11]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = NewObject -, v2 layout=[[L_14]] fields=[0]
// CHECK-NEXT: v4 = NewClosure v3, v0, v1 function=[[f_15]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_12]] flags=[IsExpected]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Box"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_16]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_8]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_8]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_8]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v5, v1 key="value"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = TypeTest v7 testedType=object
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Jump -> next b4(v9)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="__require"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] captures=[{type=env [[L_14]] flags=[IsFromCompiler]}, {type=undefined|null|[[f_10]]|builtin(ObjectGetOwnPropertyNames) flags=[IsExpected]}, {type=undefined|null|object flags=[IsExpected]}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: env [[L_14]], v1: undefined|null|[[f_10]]|builtin(ObjectGetOwnPropertyNames), v2: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetEnvironmentField v0 layout=[[L_14]]
// CHECK-NEXT: v4 = ToBoolean v3
// CHECK-NEXT: Branch v4 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b3(v6):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v7 = Call v1, -, v2 calleeName="__getOwnPropNames"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v9 = Integer
// CHECK-NEXT: v10 = ElemGet v8, v9
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v12 = ElemGet v2, v11
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v14 = Data data=[[d_17]]
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[L_11]] flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v0, v15 layout=[[L_14]]
// CHECK-NEXT: v17 = PropGet v14 key="exports"
// CHECK-NEXT: v18 = GetEnvironmentField v0 layout=[[L_14]]
// CHECK-NEXT: v19 = Call v13, -, v17, v18
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v20 = GetEnvironmentField v0 layout=[[L_14]]
// CHECK-NEXT: v21 = PropGet v20 key="exports"
// CHECK-NEXT: Return v21
// CHECK-NEXT: }
