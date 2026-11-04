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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = String string=""
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v2, v4)
// CHECK-NEXT: b1(v5, v6):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = LessEq v6, v0
// CHECK-NEXT: Branch v8 -> taken b2(), notTaken b4(v5)
// CHECK-NEXT: b2():
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="letters"
// CHECK-NEXT: v11 = Integer integer=26
// CHECK-NEXT: v12 = Mod v6, v11
// CHECK-NEXT: v13 = ElemGet v10, v12
// CHECK-NEXT: v14 = Add v5, v13
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v15 key="length"
// CHECK-NEXT: v17 = Integer integer=30
// CHECK-NEXT: v18 = Greater v16, v17
// CHECK-NEXT: Branch v18 -> taken b4(v15), notTaken b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v19 = Increment v6
// CHECK-NEXT: v20 = Convert v19 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v15, v20)
// CHECK-NEXT: b4(v21):
// CHECK-NEXT: Return v21
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="down"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v3 = Integer integer=10
// CHECK-NEXT: v4 = Convert v3 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v2, v4)
// CHECK-NEXT: b1(v5, v6):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = Greater v6, v0
// CHECK-NEXT: Branch v8 -> taken b2(), notTaken b4(v5)
// CHECK-NEXT: b2():
// CHECK-NEXT: v9 = Integer integer=1
// CHECK-NEXT: v10 = LShift v6, v9
// CHECK-NEXT: v11 = BitXor v5, v10
// CHECK-NEXT: v12 = Integer
// CHECK-NEXT: v13 = BitOr v11, v12
// CHECK-NEXT: v14 = Convert v13 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v15 = Integer integer=-40
// CHECK-NEXT: v16 = Less v6, v15
// CHECK-NEXT: Branch v16 -> taken b4(v14), notTaken b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v17 = Decrement v6
// CHECK-NEXT: v18 = Convert v17 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v14, v18)
// CHECK-NEXT: b4(v19):
// CHECK-NEXT: Return v19
// CHECK-NEXT: }
