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
// CHECK-NEXT: v0 = Boolean boolean=true
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = String string="cycle-b"
// CHECK-NEXT: v5 = Call v3, v2, v4 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: EvaluateModule module=[[m_2]] referrer=[[m_3]] [isBare]
// CHECK-NEXT: v7 = Boolean boolean=true
// CHECK-NEXT: v8 = RequireObjectCoercible v7 name="early"
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v10 = ToString v9
// CHECK-NEXT: v11 = String string=","
// CHECK-NEXT: v12 = RequireObjectCoercible v7 name="late"
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v14 = ToString v13
// CHECK-NEXT: v15 = Strcat v10, v11, v14
// CHECK-NEXT: PutModuleVariable v15 variable=[[g_6]]
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="__export"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|object flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|object):
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: v3 = ForInOpen v1
// CHECK-NEXT: Jump -> next b1(v2)
// CHECK-NEXT: b1(v4):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v6 = ForInStep v3, v1
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Branch v7 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: b3():
// CHECK-NEXT: v10 = Convert v8 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v12 = ElemGet v1, v10
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: v14 = NewObject layout=[[L_9]]
// CHECK-NEXT: PropDefine v14, v13 key="get"
// CHECK-NEXT: v16 = Boolean boolean=true
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|boolean flags=[IsExpected]}
// CHECK-NEXT: PropDefine v14, v17 key="enumerable"
// CHECK-NEXT: v19 = FinishObject v14
// CHECK-NEXT: v20 = Call v11, -, v0, v10, v19 calleeName="__defProp"
// CHECK-NEXT: Jump -> next b1(v10)
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="__init"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] captures=[{type=env [[L_10]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_10]]):
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_10]]
// CHECK-NEXT: v2 = ToBoolean v1
// CHECK-NEXT: Branch v2 -> taken b1(| 0), notTaken b2()
// CHECK-NEXT: b1(v3):
// CHECK-NEXT: v4 = GetEnvironmentField v0 layout=[[L_10]]
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v6 = GetEnvironmentField v0 layout=[[L_10]]
// CHECK-NEXT: v7 = Call v5, -, v6 calleeName="__getOwnPropNames"
// CHECK-NEXT: v8 = Integer
// CHECK-NEXT: v9 = ElemGet v7, v8
// CHECK-NEXT: v10 = ElemGet v4, v9
// CHECK-NEXT: v11 = Integer
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|number|object flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v0, v12 layout=[[L_10]]
// CHECK-NEXT: v14 = Call v10, -, v11
// CHECK-NEXT: PutEnvironmentField v0, v14 layout=[[L_10]] field=1
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: v16 = GetEnvironmentField v0 layout=[[L_10]] field=1
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
