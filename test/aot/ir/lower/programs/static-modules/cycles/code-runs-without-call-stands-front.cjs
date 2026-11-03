// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

// FILE: main.cjs
// An accessor of a global and a conversion to a string run code in front of the statement that gives the module its `__esModule`, and no call is written there: whoever they run finds no marker.
Object.defineProperty(globalThis, "peek", {
  get() {
    const m = require("./read.cjs");
    console.log("early", m.__esModule, m.a);
    return 1;
  },
});
globalThis.text = {
  toString() {
    const m = require("./converted.cjs");
    console.log("early", m.__esModule, m.a);
    return "text";
  },
};
const first = require("./read.cjs");
console.log("late", first.__esModule, first.a);
const second = require("./converted.cjs");
console.log("late", second.__esModule, second.a);

// FILE: converted.cjs
var seen = `${globalThis.text}`;
Object.defineProperty(exports, "__esModule", { value: true });
exports.a = seen;

// FILE: read.cjs
var seen = globalThis.peek;
Object.defineProperty(exports, "__esModule", { value: true });
exports.a = seen;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: get
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsSloppy, HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: EvaluateModule module=[[m_2]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v2 = Convert v1 declared={type=[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v4 = Builtin builtin=GlobalThis
// CHECK-NEXT: v5 = PropGet v4 key="console" [isFreeName]
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v7 = PropGet v6 key="log"
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v9 = String string="early"
// CHECK-NEXT: v10 = PropGet v3 key="__esModule"
// CHECK-NEXT: v11 = Convert v10 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: v12 = PropGet v3 key="a"
// CHECK-NEXT: v13 = Call v8, v6, v9, v11, v12 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v14 = Integer integer=1
// CHECK-NEXT: v15 = Convert v14 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
