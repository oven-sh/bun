// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 1

// FILE: main.js
/** @import { Size } from "./shapes" */

/** @param {import("./shapes").Point} p */
function norm(p) {
  return p.x + p.y;
}

/** @param {Size} s */
function area(s) {
  return s.width * s.height;
}

/** @param {import("./shapes").Point[]} points */
function sum(points) {
  let total = 0;
  for (let i = 0; i < points.length; i++) total += points[i].x;
  return total;
}

/** @returns {import("./shapes").Point} */
function make(kind) {
  return kind === 0 ? { x: 1, y: 2 } : kind === 1 ? { x: "1", y: 2 } : kind === 2 ? "text" : null;
}

const getter = {
  get x() {
    return 5;
  },
  y: 6,
};
const values = [{ x: 1, y: 2 }, { x: "1", y: 2 }, { y: 2 }, { x: 1.5, y: -0 }, { x: 1n, y: 2n }, "ab", 7, [3, 4], getter];
for (let round = 0; round < 3; round++) {
  for (const value of values) console.log(String(norm(value)));
}
console.log(area({ width: 2, height: 3 }), area({ width: "2", height: 3 }), area({}), area("ab"));
console.log(sum([{ x: 1 }, { x: 2 }]), sum([{ x: "a" }, { x: 2 }]), sum("ab"), sum({ length: 2, 0: { x: 1 }, 1: { x: 2 } }));
for (let kind = 0; kind < 4; kind++) {
  const made = make(kind);
  console.log(made === null ? "null" : typeof made === "string" ? made.length : made.x + made.y);
}
for (const nothing of [null, undefined]) {
  try {
    norm(nothing);
  } catch (error) {
    console.log(error instanceof TypeError);
  }
}

// FILE: shapes.d.ts
export interface Point {
  x: number;
  y: number;
}
export interface Size {
  width: number;
  height: number;
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "checkJs": false }, "files": [] }

// GENERATED: area sum x
// CHECK-LABEL: function {{*}}name="area"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="width"
// CHECK-NEXT: v2 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v0 key="height"
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v5 = Mul v2, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sum"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|[[L_2]]> flags=[IsExpected]}] results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|[[L_2]]>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v2, v4)
// CHECK-NEXT: b2(v5, v6):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = PropGet v0 key="length"
// CHECK-NEXT: v9 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v10 = Less v6, v9
// CHECK-NEXT: Branch v10 -> taken b3(| 0), notTaken b6(| 0)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v12 = ElemGet v0, v11
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="x"
// CHECK-NEXT: v15 = Convert v14 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v16 = Add v5, v15
// CHECK-NEXT: v17 = Convert v16 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v18 = Increment v11
// CHECK-NEXT: v19 = Convert v18 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v17, v19)
// CHECK-NEXT: b6(v20):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v21 = Convert v5 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v21
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="x"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=5
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
