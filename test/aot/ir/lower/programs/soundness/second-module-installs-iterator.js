// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

// FILE: main.js
import { Bag, show } from "./bag.js";
import { run } from "./late.js";
const b = new Bag();
function use(tag) { try { for (const x of b) show(tag, x); } catch (e) { show(tag, "not iterable"); } show(tag, b + 1); }
use("first");
run();
use("second");

// FILE: bag.js
function print(a, b, c) { let s = "" + a; if (b !== undefined) s += " " + b; if (c !== undefined) s += " " + c; console.log(s); }
function show(tag, v) {
  let t = typeof v;
  let extra = "";
  if (t === "number") extra = v + 1;
  else if (t === "string") extra = v + "!";
  else if (t === "object" && v !== null) extra = Object.keys(v).join(",");
  print(tag, t, extra);
}
export class Bag { constructor() { this.items = [1, 2]; } }
export { show };

// FILE: late.js
import { Bag } from "./bag.js";
export function run() {
  Bag.prototype[Symbol.iterator] = function* () { for (const x of this.items) yield "late" + x; };
  Bag.prototype.valueOf = function () { return 41; };
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="Bag"
// CHECK-NEXT: v4 = Construct v3 calleeName="Bag"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: PutModuleVariable v5 variable=[[g_4]]
// CHECK-NEXT: v7 = String string="first"
// CHECK-NEXT: v8 = Call v1, -, v7 calleeName="use"
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="run"
// CHECK-NEXT: v11 = Call v10 calleeName="run"
// CHECK-NEXT: v12 = String string="second"
// CHECK-NEXT: v13 = Call v1, -, v12 calleeName="use"
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="use"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b9():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="b"
// CHECK-NEXT: v3 = IteratorOpen v2
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b9():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v5 = IteratorResume v3
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Branch v6 -> taken b4(), notTaken b6()
// CHECK-NEXT: b4() handler=b9():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b6() handler=b9():
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7() handler=b8():
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="show"
// CHECK-NEXT: v10 = Call v9, -, v0, v7 calleeName="show"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b8() role=IterationCleanup subject=v3 handler=b9():
// CHECK-NEXT: v11 = CatchException
// CHECK-NEXT: IteratorClose v3 completion=Throw
// CHECK-NEXT: Rethrow v11
// CHECK-NEXT: b9() role=CatchHandler:
// CHECK-NEXT: v13 = CatchValue
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v15 = CheckInitialized v14 name="show"
// CHECK-NEXT: v16 = String string="not iterable"
// CHECK-NEXT: v17 = Call v15, -, v0, v16 calleeName="show"
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v18 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v19 = CheckInitialized v18 name="show"
// CHECK-NEXT: v20 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v21 = CheckInitialized v20 name="b"
// CHECK-NEXT: v22 = Integer integer=1
// CHECK-NEXT: v23 = Add v21, v22
// CHECK-NEXT: v24 = Call v19, -, v0, v23 calleeName="show"
// CHECK-NEXT: v25 = Undefined
// CHECK-NEXT: Return v25
// CHECK-NEXT: }
