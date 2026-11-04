// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 6

// FILE: main.ts
// Export equals is imported by default without es module interop.
import Point from "./class.cjs";
import plusOne from "./function.cjs";
import marked, { other } from "./marked.cjs";
import * as markedNamespace from "./marked.cjs";
import answer from "./number.cjs";
import settings from "./object.cjs";
import * as settingsNamespace from "./object.cjs";
import wrong from "./wrong.cjs";
import required = require("./function.cjs");
import RequiredPoint = require("./class.cjs");
import requiredMarked = require("./marked.cjs");

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

attempt("a function", () => [typeof plusOne, plusOne(1), plusOne.version, plusOne === required, required(2)]);
attempt("a class", () => {
  const p = new Point(1, 2);
  return [typeof Point, p.sum(), p instanceof RequiredPoint, Point === RequiredPoint, Object.keys(p).join()];
});
attempt("a subclass", () => {
  class Point3 extends Point {
    z = 3;
  }
  const p = new Point3(1, 2);
  return [p.sum() + p.z, Object.keys(p).join()];
});
attempt("an object", () => [typeof settings, settings.limit + 1, settings.name, settings.default, Object.keys(settings).join()]);
attempt("an object as a namespace", () => [settingsNamespace.limit + 1, settingsNamespace.name, typeof settingsNamespace.default, Object.keys(settingsNamespace).sort().join()]);
attempt("a file marked as an es module", () => [typeof marked, typeof other, other + 1, Object.keys(markedNamespace).sort().join(), typeof markedNamespace.default]);
attempt("a file marked as an es module, called", () => marked());
attempt("a file marked as an es module, required", () => [typeof requiredMarked, typeof requiredMarked.default, requiredMarked.other, requiredMarked.default()]);
attempt("a number", () => [typeof answer, answer + 1]);
attempt("a declaration that is wrong", () => [typeof wrong, Object.keys(wrong).join()]);
attempt("a declaration that is wrong, called", () => wrong(1) + 1);

let warm = 0;
for (let i = 0; i < 2000; i++) warm += plusOne(i) + new Point(i, 1).sum() + settings.limit + answer;
console.log("2000 rounds: " + warm);

// FILE: class.cjs
module.exports = class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  sum() {
    return this.x + this.y;
  }
};

// FILE: class.d.cts
declare class Point {
  x: number;
  y: number;
  constructor(x: number, y: number);
  sum(): number;
}
export = Point;

// FILE: function.cjs
function plusOne(n) {
  return n + 1;
}
plusOne.version = "1";
module.exports = plusOne;

// FILE: function.d.cts
declare function plusOne(n: number): number;
declare namespace plusOne {
  const version: string;
}
export = plusOne;

// FILE: marked.cjs
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = function marked() {
  return "the default of a marked file";
};
exports.other = 5;

// FILE: marked.d.cts
export default function marked(): string;
export declare const other: number;

// FILE: number.cjs
module.exports = 42;

// FILE: number.d.cts
declare const answer: number;
export = answer;

// FILE: object.cjs
module.exports = { limit: 10, name: "object", default: "a member called default" };

// FILE: object.d.cts
declare const settings: { limit: number; name: string; default: string };
export = settings;

// FILE: wrong.cjs
exports.plusOne = n => n + "!";

// FILE: wrong.d.cts
declare function plusOne(n: number): number;
export = plusOne;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "esModuleInterop": false, "ignoreDeprecations": "6.0", "allowSyntheticDefaultImports": true }, "files": [] }

// GENERATED: attempt Point3
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=" -> "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v10 = Call v1 calleeName="run"
// CHECK-NEXT: v11 = Call v9, -, v10 calleeName="show"
// CHECK-NEXT: v12 = Add v8, v11
// CHECK-NEXT: v13 = Call v6, v4, v12 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v14 = CatchValue
// CHECK-NEXT: v15 = Builtin builtin=GlobalThis
// CHECK-NEXT: v16 = PropGet v15 key="console" [isFreeName]
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="log"
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v20 = String string=" threw "
// CHECK-NEXT: v21 = Add v0, v20
// CHECK-NEXT: v22 = Builtin builtin=GlobalThis
// CHECK-NEXT: v23 = PropGet v22 key="Error" [isFreeName]
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v25 = InstanceOf v14, v24
// CHECK-NEXT: v26 = ToBoolean v25
// CHECK-NEXT: Branch v26 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v27):
// CHECK-NEXT: v28 = PropGet v14 key="constructor"
// CHECK-NEXT: v29 = PropGet v28 key="name"
// CHECK-NEXT: Jump -> next b5(v29)
// CHECK-NEXT: b4(v30):
// CHECK-NEXT: v31 = TypeOf v14
// CHECK-NEXT: Jump -> next b5(v31)
// CHECK-NEXT: b5(v32):
// CHECK-NEXT: v33 = Add v21, v32
// CHECK-NEXT: v34 = Call v19, v17, v33 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v35 = Undefined
// CHECK-NEXT: Return v35
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Point3"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_3]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_3]]}
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_4]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
