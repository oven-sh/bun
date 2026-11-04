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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Builtin builtin=JSON
// CHECK-NEXT: v2 = PropGet v1 key="stringify"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v4 = Call v3, v1, v0 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v5 = ToString v4
// CHECK-NEXT: v6 = String string=" ["
// CHECK-NEXT: v7 = Builtin builtin=Object
// CHECK-NEXT: v8 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v9 = Call v8, v7, v0 calleeName="Object.keys"
// CHECK-NEXT: v10 = PropGet v9 key="join"
// CHECK-NEXT: v11 = Call v10, v9 calleeKey="join" calleeName="join"
// CHECK-NEXT: v12 = ToString v11
// CHECK-NEXT: v13 = String string="]"
// CHECK-NEXT: v14 = Strcat v5, v6, v12, v13
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="nine"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Double number=0.5
// CHECK-NEXT: v2 = Add v0, v1
// CHECK-NEXT: v3 = String string="c"
// CHECK-NEXT: v4 = Add v3, v0
// CHECK-NEXT: v5 = Null
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: v7 = NewArray v0 contents=anything
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string|Array flags=[IsExpected]}
// CHECK-NEXT: v9 = NewObject -, v0, v2, v4, v5, v6 layout=[[L_1]] fields=[0, 1, 2, 3, 4]
// CHECK-NEXT: PropDefine v9, v8 key="f"
// CHECK-NEXT: v11 = NewObject -, v0 layout=[[L_2]] fields=[0]
// CHECK-NEXT: v12 = FinishObject v11
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|number|string|symbol|bigint|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: PropDefine v9, v13 key="g"
// CHECK-NEXT: v15 = String string="h"
// CHECK-NEXT: v16 = Add v15, v0
// CHECK-NEXT: PropDefine v9, v16 key="h"
// CHECK-NEXT: v18 = NewArray v0 contents=anything
// CHECK-NEXT: v19 = NewArray v18 contents=anything
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|Array<undefined|null|string|Array> flags=[IsExpected]}
// CHECK-NEXT: PropDefine v9, v20 key="i"
// CHECK-NEXT: v22 = FinishObject v9
// CHECK-NEXT: v23 = String string="extra"
// CHECK-NEXT: v24 = Integer integer=2
// CHECK-NEXT: v25 = Mod v0, v24
// CHECK-NEXT: v26 = Add v23, v25
// CHECK-NEXT: v27 = String string="x"
// CHECK-NEXT: v28 = Add v27, v0
// CHECK-NEXT: ElemSet v22, v26, v28
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
