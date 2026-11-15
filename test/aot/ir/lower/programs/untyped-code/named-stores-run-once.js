// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2
// CHECK-LABEL: function {{*}}name="Shape"
// CHECK-LABEL: function {{*}}name="doubled"
// CHECK-LABEL: function {{*}}name="set"
// CHECK-LABEL: function {{*}}name="set"
// CHECK-LABEL: function {{*}}name="bad"
// CHECK-LABEL: function {{*}}name="fixed"

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
