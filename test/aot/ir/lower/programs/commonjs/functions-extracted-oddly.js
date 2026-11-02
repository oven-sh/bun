// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 6

// FILE: main.js
function row(label, f) {
  let said;
  try {
    said = f();
  } catch (e) {
    said = "threw " + e.name;
  }
  console.log(label + ": " + String(said));
}
const tools = require("./files/tools.js");
const { plain, plain: renamed, missing, storedLate, replaced, absent = () => "the default" } = require("./files/tools.js");
let { plain: reassigned } = require("./files/tools.js");
const { literal } = require("./files/a_literal.js");
const { plain: throughAGetter } = require("./files/re_exports.js");
const { fromTheCycle, seenEarly } = require("./files/cycle_a.js");

row("an export", () => plain(1));
row("under another name", () => renamed(2));
row("the same closure", () => plain === renamed && plain === tools.plain);
row("a name that is not there", () => missing());
row("an export that is stored late", () => storedLate());
tools.storeLate();
row("the copy stays as it was", () => storedLate());
row("the export is there now", () => tools.storedLate());
row("an export that is replaced", () => replaced());
tools.replace();
row("the copy is not replaced", () => replaced());
row("the export is", () => tools.replaced());
row("a default in the pattern", () => absent());
row("a copy before it is stored to", () => reassigned(3));
reassigned = a => "reassigned " + a;
row("a copy that was stored to", () => reassigned(3));
row("module.exports = { .. }", () => literal(4));
row("re-exported through a getter", () => throughAGetter(5));
row("out of a cycle, afterwards", () => fromTheCycle());
row("what the other module of the cycle took out early", () => seenEarly());

// FILE: files/a_literal.js
function literal(a) {
  return "literal " + a;
}
module.exports = { literal };

// FILE: files/cycle_a.js
const b = require("./cycle_b.js");
exports.fromTheCycle = function () {
  return "from the cycle";
};
exports.seenEarly = function () {
  return b.callsWhatItTookOut();
};

// FILE: files/cycle_b.js
const { fromTheCycle } = require("./cycle_a.js");
exports.callsWhatItTookOut = function () {
  try {
    return fromTheCycle();
  } catch (e) {
    return "threw " + e.name + " in the other module";
  }
};

// FILE: files/re_exports.js
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plain = void 0;
var tools_1 = require("./tools.js");
Object.defineProperty(exports, "plain", { enumerable: true, get: function () { return tools_1.plain; } });

// FILE: files/tools.js
exports.plain = function (a) {
  return "plain " + a;
};
exports.storeLate = function () {
  exports.storedLate = function () {
    return "stored late";
  };
};
exports.replaced = function () {
  return "the first";
};
exports.replace = function () {
  exports.replaced = function () {
    return "the second";
  };
};

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: row reassigned
// CHECK-LABEL: function {{*}}name="row"
// CHECK: module=[[m_0]] text={end=156} flags=[IsSloppy, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b5():
// CHECK-NEXT: v4 = Call v1 calleeName="f"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b5():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b6(v5)
// CHECK-NEXT: b5() role=CatchHandler:
// CHECK-NEXT: v6 = CatchValue
// CHECK-NEXT: v7 = String string="threw "
// CHECK-NEXT: v8 = PropGet v6 key="name"
// CHECK-NEXT: v9 = Add v7, v8
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b6(v10)
// CHECK-NEXT: b6(v11):
// CHECK-NEXT: v12 = Builtin builtin=GlobalThis
// CHECK-NEXT: v13 = PropGet v12 key="console" [isFreeName]
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v14 key="log"
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v17 = String string=": "
// CHECK-NEXT: v18 = Add v0, v17
// CHECK-NEXT: v19 = Builtin builtin=String
// CHECK-NEXT: v20 = Call v19, -, v11 calleeName="String"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v22 = Add v18, v21
// CHECK-NEXT: v23 = Call v16, v14, v22 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v24 = Undefined
// CHECK-NEXT: Return v24
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="reassigned"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="reassigned "
// CHECK-NEXT: v2 = Add v1, v0
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
