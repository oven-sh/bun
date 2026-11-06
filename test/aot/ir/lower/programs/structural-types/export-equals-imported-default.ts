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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=" -> "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v10 = Call v1 calleeName="run"
// CHECK-NEXT: v11 = Call v9, -, v10 calleeName="show"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v13 = Add v8, v12
// CHECK-NEXT: v14 = Call v6, v4, v13 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v15 = CatchValue
// CHECK-NEXT: v16 = Builtin builtin=GlobalThis
// CHECK-NEXT: v17 = PropGet v16 key="console" [isFreeName]
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v18 key="log"
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v21 = String string=" threw "
// CHECK-NEXT: v22 = Add v0, v21
// CHECK-NEXT: v23 = Builtin builtin=GlobalThis
// CHECK-NEXT: v24 = PropGet v23 key="Error" [isFreeName]
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v26 = InstanceOf v15, v25 writtenExpression="error instanceof Error"
// CHECK-NEXT: v27 = ToBoolean v26
// CHECK-NEXT: Branch v27 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v28):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v29 = Convert v15 declared={type=undefined|null|Error flags=[IsExpected]}
// CHECK-NEXT: v30 = PropGet v29 key="constructor"
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|function site=[[w_6]]} illTypedCause=Assertion
// CHECK-NEXT: v32 = PropGet v31 key="name"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|string site=[[w_6]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b9(v33)
// CHECK-NEXT: b7(v34):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v35 = TypeOf v15
// CHECK-NEXT: Jump -> next b9(v35)
// CHECK-NEXT: b9(v36):
// CHECK-NEXT: v37 = Add v22, v36
// CHECK-NEXT: v38 = Call v20, v18, v37 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v39 = Undefined
// CHECK-NEXT: Return v39
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Point3"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_7]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_7]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_8]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
