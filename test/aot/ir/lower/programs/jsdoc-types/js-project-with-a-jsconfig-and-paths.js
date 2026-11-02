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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v2 = Builtin builtin=JSON
// CHECK-NEXT: v3 = PropGet v2 key="parse"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(JSONParse) flags=[IsExpected]}
// CHECK-NEXT: v5 = String string="{\"x\":\"1\",\"y\":2}"
// CHECK-NEXT: v6 = Call v4, v2, v5 calleeKey="parse" calleeName="JSON.parse"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v8 = Integer
// CHECK-NEXT: v9 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v10 = Integer
// CHECK-NEXT: v11 = Convert v10 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v9, v11)
// CHECK-NEXT: b2(v12, v13):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v15 = Integer integer=2000
// CHECK-NEXT: v16 = Less v13, v15
// CHECK-NEXT: Branch v16 -> taken b3(| 0), notTaken b6(| 0)
// CHECK-NEXT: b3(v17):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v18 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v19 = CheckInitialized v18 name="sum"
// CHECK-NEXT: v20 = Call v19, -, v1 calleeName="sum"
// CHECK-NEXT: v21 = Convert v20 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v22 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v23 = CheckInitialized v22 name="sum"
// CHECK-NEXT: v24 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v25 = CheckInitialized v24 name="Pixel"
// CHECK-NEXT: v26 = Integer integer=1
// CHECK-NEXT: v27 = Construct v25, -, v17, v26 calleeName="Pixel"
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v29 = Call v23, -, v28 calleeName="sum"
// CHECK-NEXT: v30 = Convert v29 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v31 = Add v21, v30
// CHECK-NEXT: v32 = Add v12, v31
// CHECK-NEXT: v33 = Convert v32 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v34 = Increment v17
// CHECK-NEXT: v35 = Convert v34 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v33, v35)
// CHECK-NEXT: b6(v36):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v37 = Builtin builtin=GlobalThis
// CHECK-NEXT: v38 = PropGet v37 key="console" [isFreeName]
// CHECK-NEXT: v39 = Convert v38 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v40 = PropGet v39 key="log"
// CHECK-NEXT: v41 = Convert v40 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v42 = String string="2000 rounds: "
// CHECK-NEXT: v43 = Add v42, v12
// CHECK-NEXT: v44 = Call v41, v39, v43 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v45 = Builtin builtin=GlobalThis
// CHECK-NEXT: v46 = PropGet v45 key="console" [isFreeName]
// CHECK-NEXT: v47 = Convert v46 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v48 = PropGet v47 key="log"
// CHECK-NEXT: v49 = Convert v48 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v50 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v51 = CheckInitialized v50 name="next"
// CHECK-NEXT: v52 = Call v51 calleeName="next"
// CHECK-NEXT: v53 = Convert v52 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v54 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v55 = CheckInitialized v54 name="sameNext"
// CHECK-NEXT: v56 = Call v55 calleeName="sameNext"
// CHECK-NEXT: v57 = Convert v56 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v58 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v59 = CheckInitialized v58 name="next"
// CHECK-NEXT: v60 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v61 = CheckInitialized v60 name="sameNext"
// CHECK-NEXT: v62 = StrictEq v59, v61
// CHECK-NEXT: v63 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v64 = CheckInitialized v63 name="sum"
// CHECK-NEXT: v65 = Call v64, -, v7 calleeName="sum"
// CHECK-NEXT: v66 = Convert v65 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v67 = PropGet v7 key="x"
// CHECK-NEXT: v68 = Convert v67 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v69 = TypeOf v68
// CHECK-NEXT: v70 = Call v49, v47, v53, v57, v62, v66, v69 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v71 = Undefined
// CHECK-NEXT: Return v71
// CHECK-NEXT: }
