// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 13
// STATISTIC: SourceFilesData = 1

// FILE: main.js
// A name that a module does not export is read off `import * as`, as a value and as a test: undefined for an ES module, also for `default` behind `export *`; what is there for a name that a star carries, for CommonJS and for JSON.
import * as plain from "./plain.js";
import * as bare from "./bare.js";
import * as starred from "./starred.js";
import * as circle from "./circle.js";
import * as ambiguous from "./ambiguous.js";
import * as overCommonJS from "./over-commonjs.js";
import * as commonjs from "./commonjs.cjs";
import * as emptyCommonJS from "./empty.cjs";
import * as data from "./data.json";

const lines = [];
const shown = value => (typeof value === "function" ? "function" : (JSON.stringify(value) ?? "undefined"));
const say = (label, ...values) => lines.push(label + ": " + values.map(shown).join(" "));
const taken = [];

say("plain", plain.named, plain.default, plain.then, plain.missing, plain.toString, plain.constructor, plain.__proto__, plain.__esModule);
if (plain.default) taken.push("plain.default");
if (typeof plain.then === "function") taken.push("plain.then");
if (plain.missing && plain.missing.deeper) taken.push("plain.missing");
if (plain.missing === undefined) taken.push("plain.missing is undefined");
if (plain.named) taken.push("plain.named");
say("plain, by default", plain.missing ?? "nothing", plain.missing || "nothing", plain.missing?.deeper, plain.named ?? "nothing");

say("bare", bare.default, bare.then, Object.keys(bare));
if (bare.default) taken.push("bare.default");

say("starred", starred.carried, starred.default, starred.then, starred.missing, Object.keys(starred));
if (starred.default) taken.push("starred.default");
if (typeof starred.then === "function") taken.push("starred.then");
if (starred.missing) taken.push("starred.missing");

say("circle", circle.one, circle.two, circle.default, circle.three);
if (circle.three) taken.push("circle.three");
if (circle.two) taken.push("circle.two");

say("ambiguous", ambiguous.same, ambiguous.first, ambiguous.second, Object.keys(ambiguous));
if (ambiguous.same) taken.push("ambiguous.same");

say("over CommonJS", overCommonJS.named, overCommonJS.then, overCommonJS.default, overCommonJS.missing);
if (overCommonJS.then) taken.push("overCommonJS.then");
if (overCommonJS.default) taken.push("overCommonJS.default");

say("CommonJS", commonjs.named, commonjs.then, commonjs.default, commonjs.missing);
if (commonjs.default) taken.push("commonjs.default");
if (commonjs.missing) taken.push("commonjs.missing");

say("empty CommonJS", emptyCommonJS.default, emptyCommonJS.missing);
if (emptyCommonJS.default) taken.push("emptyCommonJS.default");

say("JSON", data.named, data.default, data.missing);
if (data.default) taken.push("data.default");
if (data.missing) taken.push("data.missing");

say("taken", taken);
console.log(lines.join("\n"));

// FILE: ambiguous.js
export * from "./first.js";
export * from "./second.js";

// FILE: bare.js
globalThis.bareRan = true;

// FILE: circle-back.js
export * from "./circle.js";
export const two = 2;

// FILE: circle.js
export * from "./circle-back.js";
export const one = 1;

// FILE: commonjs.cjs
exports.named = 1;
exports.then = 5;

// FILE: data.json
{ "named": 1 }

// FILE: empty.cjs
globalThis.emptyRan = true;

// FILE: first.js
export const same = "of the first";
export const first = 1;

// FILE: over-commonjs.js
export * from "./commonjs.cjs";

// FILE: plain.js
export const named = 1;

// FILE: second.js
export const same = "of the second";
export const second = 2;

// FILE: starred.js
export * from "./with-default.js";

// FILE: with-default.js
export default "the default export";
export const carried = 2;
export function then() {}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: shown say
// CHECK-LABEL: function {{*}}name="shown"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = TypeTest v0 testedType=function
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = String string="function"
// CHECK-NEXT: Jump -> next b6(v3)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: v5 = NarrowByTest v0, v4
// CHECK-NEXT: v6 = Builtin builtin=JSON
// CHECK-NEXT: v7 = PropGet v6 key="stringify"
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v9 = Call v8, v6, v5 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v10 = TypeTest v9 testedType=undefined|null
// CHECK-NEXT: Branch v10 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: v12 = String string="undefined"
// CHECK-NEXT: Jump -> next b5(v12)
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: Jump -> next b5(v13)
// CHECK-NEXT: b5(v14):
// CHECK-NEXT: Jump -> next b6(v14)
// CHECK-NEXT: b6(v15):
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="say"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[HasRestParameter] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=Array flags=[IsFromCompiler]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: Array):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="lines"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = String string=": "
// CHECK-NEXT: v6 = Add v0, v5
// CHECK-NEXT: v7 = PropGet v1 key="map"
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="shown"
// CHECK-NEXT: v10 = Call v7, v1, v9 calleeKey="map" calleeName="values.map"
// CHECK-NEXT: v11 = PropGet v10 key="join"
// CHECK-NEXT: v12 = String string=" "
// CHECK-NEXT: v13 = Call v11, v10, v12 calleeKey="join" calleeName="join"
// CHECK-NEXT: v14 = Add v6, v13
// CHECK-NEXT: v15 = Call v4, v3, v14 calleeKey="push" calleeName="lines.push"
// CHECK-NEXT: ReturnCall v15
// CHECK-NEXT: }
