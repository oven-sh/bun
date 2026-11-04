// RUN: lower
// OPTIONS: builtin-modules
// CWD: js-project-with-a-jsconfig-and-paths
// STATISTIC: SourceFilesInferred = 3

// FILE: js-project-with-a-jsconfig-and-paths/main.js
import { next } from "@lib/counter.js";
import { next as sameNext } from "./lib/counter.js";
import { Pixel, sum } from "shapes";

/** @import { Point } from "shapes" */

/** @type {Point} */
const point = { x: 1, y: 2 };

/** @type {Point} */
const parsed = JSON.parse('{"x":"1","y":2}');

let total = 0;
for (let i = 0; i < 2000; i++) total += sum(point) + sum(new Pixel(i, 1));
console.log("2000 rounds: " + total);
console.log(next(), sameNext(), next === sameNext, sum(parsed), typeof parsed.x);

// FILE: js-project-with-a-jsconfig-and-paths/lib/counter.js
let count = 0;

/** @returns {number} */
export function next() {
  return ++count;
}

// FILE: js-project-with-a-jsconfig-and-paths/lib/shapes.js
/** @typedef {{ x: number, y: number }} Point */

/**
 * @param {Point} p
 * @returns {number}
 */
export function sum(p) {
  return p.x + p.y;
}

export class Pixel {
  /**
   * @param {number} x
   * @param {number} y
   */
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

// FILE: js-project-with-a-jsconfig-and-paths/jsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "checkJs": true, "paths": { "@lib/*": [ "./lib/*" ], "shapes": [ "./lib/shapes.js" ] } }, "files": [] }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "checkJs": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Data data=[[d_1]]
// CHECK-NEXT: v1 = Builtin builtin=JSON
// CHECK-NEXT: v2 = PropGet v1 key="parse"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(JSONParse) flags=[IsExpected]}
// CHECK-NEXT: v4 = String string="{\"x\":\"1\",\"y\":2}"
// CHECK-NEXT: v5 = Call v3, v1, v4 calleeKey="parse" calleeName="JSON.parse"
// CHECK-NEXT: v6 = Integer
// CHECK-NEXT: v7 = Convert v6 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v8 = Integer
// CHECK-NEXT: v9 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v7, v9)
// CHECK-NEXT: b1(v10, v11):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v13 = Integer integer=2000
// CHECK-NEXT: v14 = Less v11, v13
// CHECK-NEXT: Branch v14 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v16 = CheckInitialized v15 name="sum"
// CHECK-NEXT: v17 = Call v16, -, v0 calleeName="sum"
// CHECK-NEXT: v18 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v19 = CheckInitialized v18 name="sum"
// CHECK-NEXT: v20 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v21 = CheckInitialized v20 name="Pixel"
// CHECK-NEXT: v22 = Integer integer=1
// CHECK-NEXT: v23 = Construct v21, -, v11, v22 calleeName="Pixel"
// CHECK-NEXT: v24 = Call v19, -, v23 calleeName="sum"
// CHECK-NEXT: v25 = Add v17, v24
// CHECK-NEXT: v26 = Add v10, v25
// CHECK-NEXT: v27 = Convert v26 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v28 = Increment v11
// CHECK-NEXT: v29 = Convert v28 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v27, v29)
// CHECK-NEXT: b3():
// CHECK-NEXT: v30 = Builtin builtin=GlobalThis
// CHECK-NEXT: v31 = PropGet v30 key="console" [isFreeName]
// CHECK-NEXT: v32 = Convert v31 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v33 = PropGet v32 key="log"
// CHECK-NEXT: v34 = Convert v33 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v35 = String string="2000 rounds: "
// CHECK-NEXT: v36 = Add v35, v10
// CHECK-NEXT: v37 = Call v34, v32, v36 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v38 = Builtin builtin=GlobalThis
// CHECK-NEXT: v39 = PropGet v38 key="console" [isFreeName]
// CHECK-NEXT: v40 = Convert v39 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v41 = PropGet v40 key="log"
// CHECK-NEXT: v42 = Convert v41 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v43 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v44 = CheckInitialized v43 name="next"
// CHECK-NEXT: v45 = Call v44 calleeName="next"
// CHECK-NEXT: v46 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v47 = CheckInitialized v46 name="sameNext"
// CHECK-NEXT: v48 = Call v47 calleeName="sameNext"
// CHECK-NEXT: v49 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v50 = CheckInitialized v49 name="next"
// CHECK-NEXT: v51 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v52 = CheckInitialized v51 name="sameNext"
// CHECK-NEXT: v53 = StrictEq v50, v52
// CHECK-NEXT: v54 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v55 = CheckInitialized v54 name="sum"
// CHECK-NEXT: v56 = Call v55, -, v5 calleeName="sum"
// CHECK-NEXT: v57 = PropGet v5 key="x"
// CHECK-NEXT: v58 = TypeOf v57
// CHECK-NEXT: v59 = Call v42, v40, v45, v48, v53, v56, v58 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v60 = Undefined
// CHECK-NEXT: Return v60
// CHECK-NEXT: }
