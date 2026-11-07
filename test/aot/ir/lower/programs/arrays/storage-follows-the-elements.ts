// RUN: lower
// OPTIONS: builtin-modules

// The code that creates an array allocates the storage that fits the elements the build found for it, and the code that reads it expects that storage. Each array here is created with small integers in view and then gets, at run time, what such storage cannot hold: a fraction, NaN, -0, undefined, a string, a hole, an element far past the end, a shorter and a longer length. Every read answers as in plain Bun.
function sum(list: number[]): string {
  let total = 0, holes = 0;
  for (let i = 0; i < list.length; ++i) {
    const element = list[i];
    if (element === undefined) ++holes; else total += element;
  }
  return total + " (" + list.length + " long, " + holes + " missing)";
}
function chase(list: number[], key: number): number {
  key = list[key];
  key = list[key];
  key = list[key];
  return key;
}
function integers(count: number): number[] {
  const list: number[] = [];
  for (let i = 0; i < count; ++i) list.push((i * 7 + 1) & 7);
  return list;
}
const count = process.argv.length > 100 ? 3 : 8;

const plain = integers(count);
console.log("integers:", sum(plain), chase(plain, 1), chase(plain, 7), chase(plain, 100));

const withFraction = integers(count);
withFraction.push(0.5);
console.log("a fraction:", sum(withFraction), withFraction[8], chase(withFraction, 8));

const withNaN = integers(count);
withNaN[2] = NaN;
console.log("NaN:", sum(withNaN), withNaN[2], chase(withNaN, 2));

const withNegativeZero = integers(count);
withNegativeZero[0] = -0;
console.log("-0:", sum(withNegativeZero), Object.is(withNegativeZero[0], -0), 1 / withNegativeZero[0]);

const withUndefined = integers(count) as (number | undefined)[];
withUndefined[3] = undefined;
console.log("undefined:", sum(withUndefined as number[]), withUndefined[3], 3 in withUndefined);

const withString = integers(count) as unknown[];
withString[1] = "one";
console.log("a string:", withString.join(), typeof withString[1], typeof withString[2]);

const withHole = integers(count);
delete withHole[4];
console.log("a hole:", sum(withHole), 4 in withHole, withHole[4]);

const farPastTheEnd = integers(count);
farPastTheEnd[100] = 1;
console.log("far past the end:", sum(farPastTheEnd), farPastTheEnd[100], farPastTheEnd[99]);

const veryFar = integers(count);
veryFar[5000000] = 2;
console.log("very far past the end:", veryFar.length, veryFar[5000000], veryFar[4999999], veryFar[1]);

const shorter = integers(count);
shorter.length = 2;
console.log("a shorter length:", sum(shorter), shorter[2], chase(shorter, 0));

const longer = integers(count);
longer.length = 12;
console.log("a longer length:", sum(longer), longer[11], 11 in longer);

const ofHoles: number[] = new Array(5);
ofHoles[1] = 3;
console.log("new Array(5):", sum(ofHoles), ofHoles[0], ofHoles[1]);

const large = integers(count);
large.push(2147483648, -2147483649);
console.log("past 32 bits:", sum(large), large[8], large[9]);

const named = integers(count) as number[] & Record<string, number>;
named["undefined"] = 42;
named["-1"] = 43;
named["1.5"] = 44;
console.log("names that are no indexes:", named[undefined as unknown as number], named[-1], named[1.5], chase(named, 100), sum(named));

function make(first: unknown): unknown[] { return [first]; }
const madeWithInteger = make(1), madeWithString = make("s");
console.log("one literal, two contents:", madeWithInteger[0], madeWithString[0], madeWithInteger.length + madeWithString.length);

// GENERATED: chase integers make
// CHECK-LABEL: function {{*}}name="chase"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|Array<number> site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=number site=[[w_2]]}] results=[{type=number site=[[w_3]]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<number>, v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = ElemGet v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_4]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v4 = ElemGet v0, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_5]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v6 = ElemGet v0, v5
// CHECK-NEXT: v7 = Convert v6 declared={type=number site=[[w_6]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="integers"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_7]]}] results=[{type=undefined|null|Array<number> site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Data data=[[d_9]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|Array<number> site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_11]]}
// CHECK-NEXT: Jump -> next b2(v4)
// CHECK-NEXT: b2(v5: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = Less v5, v0
// CHECK-NEXT: Branch v7 -> taken b3(| 0, 1), notTaken b6(| 0, 1)
// CHECK-NEXT: b3(v8, v9):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v10 = PropGet v2 key="push"
// CHECK-NEXT: v11 = Integer integer=7
// CHECK-NEXT: v12 = Mul v8, v11
// CHECK-NEXT: v13 = Integer integer=1
// CHECK-NEXT: v14 = Add v12, v13
// CHECK-NEXT: v15 = Integer integer=7
// CHECK-NEXT: v16 = BitAnd v14, v15
// CHECK-NEXT: v17 = Call v10, v2, v16 calleeKey="push" calleeName="list.push"
// CHECK-NEXT: v18 = Convert v17 declared={type=number site=[[w_12]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v19 = Increment v8
// CHECK-NEXT: v20 = Convert v19 declared={type=number site=[[w_11]]}
// CHECK-NEXT: Jump -> next b2(v20)
// CHECK-NEXT: b6(v21, v22):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|Array site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewArray v0 contents=anything
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|Array site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
