// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.js
// Stores `x.name = v` at the top level of a module and in functions that run once: to literals, instances, classes, functions, prototypes, arrays, proxies, setters that throw, frozen objects, primitives, undefined and null; strict and sloppy.
import sloppy from "./sloppy.cjs";
const lines = [];
function say(...parts) {
  lines.push(parts.map(part => (typeof part === "string" ? part : JSON.stringify(part) ?? String(part))).join(" "));
}
function attempt(label, run) {
  try {
    say(label, run());
  } catch (error) {
    say(label, "threw", error.constructor.name);
  }
}

const literal = { alpha: 1, beta: 2 };
literal.alpha = "replaced";
say(literal);
literal.gamma = "added";
say(literal, Object.keys(literal).join());

class Shape {
  static kind = "shape";
  static set tuned(value) { Shape.kind = "tuned " + value; }
  sides = 0;
  set doubled(value) { this.sides = value / 2; }
}
const shape = new Shape();
shape.sides = 3;
say(shape.sides);
shape.doubled = 10;
say(shape.sides);
shape.extra = "beside the fields";
say(shape.extra, Object.keys(shape).join());
Shape.kind = "changed";
say(Shape.kind);
Shape.tuned = "up";
say(Shape.kind);
Shape.fresh = "new static";
say(Shape.fresh, Object.keys(Shape).join());

function legacy() {}
legacy.prototype.greet = function () { return "hello"; };
say(new legacy().greet());
legacy.helper = 1;
say(legacy.helper);
const list = [1, 2, 3];
list.label = "named";
say(list.label, list.length);
list.length = 1;
say(list);

const seen = [];
const trapped = new Proxy({}, { set(target, key, value) { seen.push(String(key) + "=" + value); target[key] = value; return true; } });
trapped.alpha = 1;
say(seen, trapped.alpha);
const refusing = new Proxy({}, { set() { return false; } });
attempt("a proxy that refuses", () => { refusing.alpha = 1; return "stored"; });

const throwing = { set bad(value) { throw new RangeError("from the setter " + value); } };
try {
  throwing.bad = 7;
  say("not reached");
} catch (error) {
  say("caught", error.message);
}
const onlyGetter = { get fixed() { return 1; } };
attempt("only a getter", () => { onlyGetter.fixed = 2; return onlyGetter.fixed; });
const frozen = Object.freeze({ alpha: 1 });
attempt("frozen, replaced", () => { frozen.alpha = 2; return frozen.alpha; });
attempt("frozen, added", () => { frozen.beta = 2; return frozen.beta; });
let nothing;
attempt("of undefined", () => { nothing.alpha = 1; });
attempt("of null", () => { null.alpha = 1; });
attempt("of a number", () => { (5).alpha = 1; return "stored"; });
attempt("of a string", () => { "text".alpha = 1; return "stored"; });
try {
  nothing.alpha = 1;
} catch (error) {
  say("at the top level", error.constructor.name);
}
const above = { set inherited(value) { this.landed = value; } };
const below = Object.create(above);
below.inherited = "through the chain";
say(below.landed, Object.keys(below).join());
const bare = Object.create(null);
bare.alpha = 1;
say(bare.alpha);
const wide = {};
wide.p0 = 0; say(0); wide.p1 = 1; say(1); wide.p2 = 2; say(2); wide.p3 = 3; say(3); wide.p4 = 4; say(4); wide.p5 = 5; say(5); wide.p6 = 6; say(6); wide.p7 = 7; say(7); wide.p8 = 8; say(8);
say(wide);
say("sloppy", sloppy);
console.log(lines.join("\n"));

// FILE: sloppy.cjs
var results = [];
var literal = { alpha: 1 };
literal.alpha = 2;
results.push(literal.alpha);
literal.beta = 3;
results.push(literal.beta);
var frozen = Object.freeze({ alpha: 1 });
frozen.alpha = 2;
results.push(frozen.alpha);
frozen.beta = 2;
results.push(frozen.beta);
var onlyGetter = { get fixed() { return 1; } };
onlyGetter.fixed = 2;
results.push(onlyGetter.fixed);
(5).alpha = 1;
results.push("a number took it");
"text".alpha = 1;
results.push("a string took it");
var refusing = new Proxy({}, { set: function () { return false; } });
refusing.alpha = 1;
results.push("a proxy refused in silence");
try {
  undefined.alpha = 1;
} catch (error) {
  results.push(error.constructor.name);
}
exports.first = 1;
module.exports.second = 2;
results.push(Object.keys(exports).join());
module.exports = results;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: Shape doubled set bad fixed
// CHECK-LABEL: function {{*}}name="Shape"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_3]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="doubled"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[HasThis, HasExplicitName] length=1 thisType={type=[[L_2]] flags=[IsExpected]} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_2]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v3 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v4 = Integer integer=2
// CHECK-NEXT: v5 = Div v3, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v2, v6 key="sides"
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=3 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|string|symbol flags=[IsExpected]}, {type=anything}] results=[{type=true flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string|symbol, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="seen"
// CHECK-NEXT: v5 = PropGet v4 key="push"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v7 = Builtin builtin=String
// CHECK-NEXT: v8 = Call v7, -, v1 calleeName="String"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v10 = String string="="
// CHECK-NEXT: v11 = Add v9, v10
// CHECK-NEXT: v12 = Add v11, v2
// CHECK-NEXT: v13 = Call v6, v4, v12 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: ElemSet v0, v1, v2
// CHECK-NEXT: v15 = Boolean boolean=true
// CHECK-NEXT: v16 = Convert v15 declared={type=true flags=[IsExpected]}
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=false flags=[IsExpected]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Boolean
// CHECK-NEXT: v1 = Convert v0 declared={type=false flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="bad"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="RangeError" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(RangeError) flags=[IsExpected]}
// CHECK-NEXT: v4 = String string="from the setter "
// CHECK-NEXT: v5 = Add v4, v0
// CHECK-NEXT: v6 = Construct v3, -, v5 calleeName="RangeError"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|RangeError flags=[IsExpected]}
// CHECK-NEXT: Throw v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="fixed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
