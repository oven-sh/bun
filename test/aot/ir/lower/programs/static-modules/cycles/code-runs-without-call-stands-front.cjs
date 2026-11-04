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
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsSloppy, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: RecordRequire module=[[m_1]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_1]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_1]] referrer=[[m_0]]
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: v5 = Builtin builtin=GlobalThis
// CHECK-NEXT: v6 = PropGet v5 key="console" [isFreeName]
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v8 = PropGet v7 key="log"
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v10 = String string="early"
// CHECK-NEXT: v11 = PropGet v4 key="__esModule"
// CHECK-NEXT: v12 = PropGet v4 key="a"
// CHECK-NEXT: v13 = Call v9, v7, v10, v11, v12 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v14 = Integer integer=1
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
