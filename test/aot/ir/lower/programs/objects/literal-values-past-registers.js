// RUN: lower
// OPTIONS: builtin-modules

// Untyped object literals with more values than the allocation stub takes in registers. A later store under a computed key makes two of them ordinary objects. The values past the registers are cells, and every value is read again after forced collections.
function describe(object) {
  return `${JSON.stringify(object)} [${Object.keys(object).join()}]`;
}

function seven(i) {
  const object = { a: "a" + i, b: [i], c: { at: i }, d: "d" + i, e: [i, i + 1], f: { at: i + 1 }, g: "g" + i };
  object["extra" + (i % 2)] = i;
  return object;
}
function isSeven(object, i) {
  return object.a === "a" + i && object.b[0] === i && object.c.at === i && object.d === "d" + i && object.e[1] === i + 1 && object.f.at === i + 1 && object.g === "g" + i;
}

function nine(i) {
  const object = { a: i, b: i + 0.5, c: "c" + i, d: null, e: undefined, f: [i], g: { at: i }, h: "h" + i, i: [[i]] };
  object["extra" + (i % 2)] = "x" + i;
  return object;
}
function isNine(object, i) {
  return object.a === i && object.b === i + 0.5 && object.c === "c" + i && object.d === null && object.e === undefined && object.f[0] === i && object.g.at === i && object.h === "h" + i && object.i[0][0] === i;
}

function sevenWithFixedKeys(i) {
  return { a: "a" + i, b: [i], c: { at: i }, d: "d" + i, e: [i, i + 1], f: { at: i + 1 }, g: "g" + i };
}

const cases = [
  ["seven", seven, isSeven],
  ["nine", nine, isNine],
  ["seven with fixed keys", sevenWithFixedKeys, isSeven],
];

for (const [label, make, isIntact] of cases) {
  const first = make(1);
  Bun.gc(true);
  console.log(label, describe(first));

  let damaged = 0;
  const survivors = [];
  for (let round = 0; round < 20000; round++) {
    const object = make(round);
    if (!isIntact(object, round)) damaged++;
    if (round % 5000 === 4999) {
      survivors.push([object, round]);
      Bun.gc(true);
    }
  }
  Bun.gc(true);
  console.log(label, "damaged", damaged);
  for (const [survivor, round] of survivors) console.log(label, isIntact(survivor, round), describe(survivor));
}

// GENERATED: describe nine
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=JSON
// CHECK-NEXT: v2 = PropGet v1 key="stringify"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v4 = Call v3, v1, v0 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v6 = ToString v5
// CHECK-NEXT: v7 = String string=" ["
// CHECK-NEXT: v8 = Builtin builtin=Object
// CHECK-NEXT: v9 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v10 = Call v9, v8, v0 calleeName="Object.keys"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v12 = PropGet v11 key="join"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: v14 = Call v13, v11 calleeKey="join" calleeName="join"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v16 = ToString v15
// CHECK-NEXT: v17 = String string="]"
// CHECK-NEXT: v18 = Strcat v6, v7, v16, v17
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v19
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="nine"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|[[L_2]] flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v2 = Double number=0.5
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = String string="c"
// CHECK-NEXT: v5 = Add v4, v1
// CHECK-NEXT: v6 = NewObject -, v1, v3 layout=[[L_2]] fields=[0, 1]
// CHECK-NEXT: PropDefine v6, v5 key="c"
// CHECK-NEXT: v8 = Null
// CHECK-NEXT: PropDefine v6, v8 key="d"
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: PropDefine v6, v10 key="e"
// CHECK-NEXT: v12 = NewArray v1 contents=anything
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string|Array flags=[IsExpected]}
// CHECK-NEXT: PropDefine v6, v14 key="f"
// CHECK-NEXT: v16 = NewObject -, v1 layout=[[L_4]] fields=[0]
// CHECK-NEXT: v17 = FinishObject v16
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|number|string|symbol|bigint|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: PropDefine v6, v18 key="g"
// CHECK-NEXT: v20 = String string="h"
// CHECK-NEXT: v21 = Add v20, v1
// CHECK-NEXT: PropDefine v6, v21 key="h"
// CHECK-NEXT: v23 = NewArray v1 contents=anything
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v25 = NewArray v24 contents=undefined|null|Array
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|Array<undefined|null|Array> flags=[IsExpected]}
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|Array<undefined|null|string|Array> flags=[IsExpected]}
// CHECK-NEXT: PropDefine v6, v27 key="i"
// CHECK-NEXT: v29 = FinishObject v6
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v31 = String string="extra"
// CHECK-NEXT: v32 = Integer integer=2
// CHECK-NEXT: v33 = Mod v1, v32
// CHECK-NEXT: v34 = Add v31, v33
// CHECK-NEXT: v35 = String string="x"
// CHECK-NEXT: v36 = Add v35, v1
// CHECK-NEXT: ElemSet v30, v34, v36
// CHECK-NEXT: Return v30
// CHECK-NEXT: }
