// RUN: lower
// OPTIONS: builtin-modules

// One file of CommonJS and ES modules as a bundler writes it: every module behind a function that runs it at the first call.
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) =>
  function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])((fn = 0))), res;
  };
var __commonJS = (cb, mod) =>
  function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
var __export = (target, all) => {
  for (var name in all) __defProp(target, name, { get: all[name], enumerable: true });
};

var log = [];

var require_numbers = __commonJS({
  "numbers.js"(exports) {
    log.push("numbers");
    exports.one = 1;
    exports.double = n => n * 2;
  },
});

var require_texts = __commonJS({
  "texts.js"(exports, module) {
    log.push("texts");
    var numbers = require_numbers();
    module.exports = { shout: text => text.toUpperCase() + "!".repeat(numbers.double(numbers.one)) };
  },
});

var require_cycle_a = __commonJS({
  "cycle-a.js"(exports) {
    log.push("cycle-a");
    exports.early = "a";
    var b = require_cycle_b();
    exports.late = b.seen + "+a";
  },
});

var require_cycle_b = __commonJS({
  "cycle-b.js"(exports) {
    log.push("cycle-b");
    var a = require_cycle_a();
    exports.seen = `${a.early},${a.late}`;
  },
});

var require_throws = __commonJS({
  "throws.js"(exports) {
    log.push("throws");
    exports.before = true;
    throw new Error("does not load");
  },
});

var shapes_exports = {};
__export(shapes_exports, { area: () => area, sides: () => sides });
var area, sides;
var init_shapes = __esm({
  "shapes.js"() {
    log.push("shapes");
    area = (w, h) => w * h;
    sides = 4;
  },
});

console.log(require_texts().shout("hey"), require_texts() === require_texts(), require_numbers().one);
console.log(require_cycle_a().late, require_cycle_b().seen);
try {
  require_throws();
} catch (error) {
  console.log(error.message, require_throws().before);
}
console.log(typeof area, init_shapes(), init_shapes(), shapes_exports.area(2, 3), shapes_exports.sides, Object.keys(shapes_exports).join());
console.log(log.join());
console.log(require_numbers.name, require_texts.name, init_shapes.name, require_numbers.length, require_numbers === require_texts);

// GENERATED: cycle-b.js __export __init
// CHECK-LABEL: function {{*}}name="cycle-b.js"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=CommonJsModule flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Boolean boolean=true
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v5 = String string="cycle-b"
// CHECK-NEXT: v6 = Call v4, v2, v5 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_4]] [isBare]
// CHECK-NEXT: v8 = Boolean boolean=true
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|number|string|symbol|bigint|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v10 = RequireObjectCoercible v9
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v12 = ToString v11
// CHECK-NEXT: v13 = String string=","
// CHECK-NEXT: v14 = RequireObjectCoercible v9
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v16 = ToString v15
// CHECK-NEXT: v17 = Strcat v12, v13, v16
// CHECK-NEXT: PutModuleVariable v17 variable=[[g_8]]
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: Return v19
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="__export"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|object flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: v3 = ForInOpen v1
// CHECK-NEXT: Jump -> next b2(v2)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v6 = ForInStep v3, v1
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Branch v7 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: b4():
// CHECK-NEXT: v10 = Convert v8 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v12 = ElemGet v1, v10
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[f_11]] flags=[IsExpected]}
// CHECK-NEXT: v14 = NewObject layout=[[L_12]]
// CHECK-NEXT: PropDefine v14, v13 key="get"
// CHECK-NEXT: v16 = Boolean boolean=true
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|boolean flags=[IsExpected]}
// CHECK-NEXT: PropDefine v14, v17 key="enumerable"
// CHECK-NEXT: v19 = FinishObject v14
// CHECK-NEXT: v20 = Call v11, -, v0, v10, v19 calleeName="__defProp"
// CHECK-NEXT: Jump -> next b2(v10)
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="__init"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] captures=[{type=env [[L_13]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_14]]] {
// CHECK-NEXT: b0(v0: env [[L_13]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_13]]
// CHECK-NEXT: v2 = ToBoolean v1
// CHECK-NEXT: Branch v2 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v4 = GetEnvironmentField v0 layout=[[L_13]]
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_15]]
// CHECK-NEXT: v6 = GetEnvironmentField v0 layout=[[L_13]]
// CHECK-NEXT: v7 = Call v5, -, v6 calleeName="__getOwnPropNames"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v9 = Integer
// CHECK-NEXT: v10 = ElemGet v8, v9
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v12 = ElemGet v4, v11
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v14 = Integer
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|number|object flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v0, v15 layout=[[L_13]]
// CHECK-NEXT: v17 = Call v13, -, v14
// CHECK-NEXT: PutEnvironmentField v0, v17 layout=[[L_13]] field=1
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4(v19):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v20 = GetEnvironmentField v0 layout=[[L_13]] field=1
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
