// RUN: lower
// OPTIONS: builtin-modules

// A counter that starts at an integer and steps by one, below a bound of type number: every kind of number is the bound once, and the loop uses its counter as an index, for its bits, in a sum and as a value.
const letters = "abcdefghijklmnopqrstuvwxyz";
const table = [];
for (let i = 0;i < 40; i++)
  table.push(i * 7);
function bits(n) {
  let sum = 0;
  for (let i = 0;i < n; i++) {
    sum = sum + (i & 5) | 0;
    if (i > 50)
      break;
  }
  return sum;
}
function elements(n) {
  let sum = 0, missing = 0;
  for (let i = 0;i < n; i++) {
    const value = table[i];
    if (value === void 0)
      missing++;
    else
      sum += value;
    if (missing > 3)
      break;
  }
  return sum + "/" + missing;
}
function characters(n) {
  let out = "";
  for (let i = 0;i <= n; i++) {
    out += letters[i % 26];
    if (out.length > 30)
      break;
  }
  return out;
}
function down(n) {
  let sum = 0;
  for (let i = 10;i > n; i--) {
    sum = sum ^ i << 1 | 0;
    if (i < -40)
      break;
  }
  return sum;
}
function last(n) {
  let i = 0;
  for (;i < n; i += 3)
    if ((i & 1023) === 1023 || i > 100)
      break;
  return i;
}
function nearTheEndOfInt32(n) {
  let seen = "";
  for (let i = 2147483640;i < n; i++) {
    seen += (i | 0) + "," + i % 7 + ";";
    if (seen.length > 400)
      break;
  }
  return seen;
}
function changed(n) {
  let sum = 0;
  for (let i = 0;i < n; i++) {
    sum = sum + (i & 3) | 0;
    if (i === 4)
      n = n / 2 + 0.25;
  }
  return sum;
}
const bounds = [0, -0, 1, 7, 7.5, 6.999999, -1, -7.5, 39, 40, 41, 0.1, NaN, 1 / 0, -1 / 0, 2147483646, 2147483647, 2147483648, 2147483650.5, 4294967296, 9007199254740992, 1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000, Number.MIN_VALUE, Number(process.env.NO_SUCH_VARIABLE ?? "12")];
for (const work of [bits, elements, characters, down, last, nearTheEndOfInt32, changed]) {
  const answers = [];
  for (const bound of bounds)
    answers.push(work === changed && !(bound < 100) ? "-" : work(bound));
  console.log(work.name, answers.join(" "));
}

// GENERATED: characters down
// CHECK-LABEL: function {{*}}name="characters"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string=""
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v2, v4)
// CHECK-NEXT: b2(v5, v6):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v9 = LessEq v6, v8
// CHECK-NEXT: Branch v9 -> taken b3(| 0, 1), notTaken b8(| 0, 1)
// CHECK-NEXT: b3(v10, v11):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="letters"
// CHECK-NEXT: v14 = Integer integer=26
// CHECK-NEXT: v15 = Mod v10, v14
// CHECK-NEXT: v16 = ElemGet v13, v15
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v18 = Add v5, v17
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v20 = PropGet v19 key="length"
// CHECK-NEXT: v21 = Convert v20 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v22 = Integer integer=30
// CHECK-NEXT: v23 = Greater v21, v22
// CHECK-NEXT: Branch v23 -> taken b5(), notTaken b6()
// CHECK-NEXT: b5():
// CHECK-NEXT: Jump -> next b9(v19)
// CHECK-NEXT: b6():
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v24 = Increment v10
// CHECK-NEXT: v25 = Convert v24 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v19, v25)
// CHECK-NEXT: b8(v26, v27):
// CHECK-NEXT: Jump -> next b9(v5)
// CHECK-NEXT: b9(v28):
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v29
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="down"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v3 = Integer integer=10
// CHECK-NEXT: v4 = Convert v3 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v2, v4)
// CHECK-NEXT: b2(v5, v6):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v9 = Greater v6, v8
// CHECK-NEXT: Branch v9 -> taken b3(| 0, 1), notTaken b10(| 0, 1)
// CHECK-NEXT: b3(v10, v11):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v12 = Integer integer=1
// CHECK-NEXT: v13 = LShift v10, v12
// CHECK-NEXT: v14 = BitXor v5, v13
// CHECK-NEXT: v15 = Integer
// CHECK-NEXT: v16 = BitOr v14, v15
// CHECK-NEXT: v17 = Convert v16 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v18 = Integer integer=-40
// CHECK-NEXT: v19 = Less v10, v18
// CHECK-NEXT: Branch v19 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v20):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: Jump -> next b11(v17)
// CHECK-NEXT: b7(v21):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v22 = Decrement v21
// CHECK-NEXT: v23 = Convert v22 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v17, v23)
// CHECK-NEXT: b10(v24, v25):
// CHECK-NEXT: Jump -> next b11(v5)
// CHECK-NEXT: b11(v26):
// CHECK-NEXT: v27 = Convert v26 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v27
// CHECK-NEXT: }
