// RUN: lower
// OPTIONS: builtin-modules

// Element reads through every global type whose name ends in "Array": the twelve typed arrays, which vouch for their elements, and the six others, which do not.
function sumOf(list: Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array): number {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i]!;
  return total;
}
function sumOfHalves(list: Float16Array): number {
  return list[0]! + list[1]!;
}
function sumOfBig(list: BigInt64Array | BigUint64Array): bigint {
  return list[0]! + list[1]!;
}
function pastTheEnd(list: Float64Array, big: BigInt64Array): string {
  try {
    return typeof list[5] + " " + typeof big[5] + " " + typeof list[-1];
  } catch (error) {
    return "caught " + (error as Error).name;
  }
}
function lengthOfFirst(list: ConcatArray<string>): number {
  return list[0]!.length;
}
function lengthOfLast(list: ReadonlyArray<string>): number {
  return list[list.length - 1]!.length;
}
function groups(found: RegExpMatchArray): string {
  return found[0]!.length + " " + typeof found[1] + " " + typeof found[2] + " " + found.length;
}
function executed(found: RegExpExecArray): string {
  return found[0]! + " " + typeof found[2] + " " + found.index;
}
function places(found: RegExpIndicesArray): string {
  return found[0]!.join() + " " + typeof found[2];
}
function tag(parts: TemplateStringsArray, ..._values: unknown[]): number {
  return parts[0]!.length + parts[1]!.length + parts.length;
}

const numbers = [1, 2, 3];
console.log(
  sumOf(new Int8Array(numbers)), sumOf(new Uint8Array(numbers)), sumOf(new Uint8ClampedArray([1, 300])), sumOf(new Int16Array(numbers)), sumOf(new Uint16Array(numbers)),
  sumOf(new Int32Array(numbers)), sumOf(new Uint32Array([4294967295, 1])), sumOf(new Float32Array([0.5, 0.25])), sumOf(new Float64Array([1.5, NaN])), sumOf(new Float64Array([1.5, -0])),
);
console.log(sumOfHalves(new Float16Array([0.5, 1.5])), String(sumOfBig(new BigInt64Array([1n, -2n]))), String(sumOfBig(new BigUint64Array([1n, 2n]))));
console.log(pastTheEnd(new Float64Array(2), new BigInt64Array(2)));
console.log(lengthOfFirst(["abc", "d"]), lengthOfLast(["abc", "de"]));
console.log(groups("a1b22".match(/(\d)(x)?/)!), executed(/(\d)(x)?/.exec("a1b22")!), places(/(\d)(x)?/d.exec("a1b22")!.indices!));
console.log(tag`ab${1}c`);

// GENERATED: sumOf sumOfHalves sumOfBig lengthOfLast
// CHECK-LABEL: function {{*}}name="sumOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Float32Array|Float64Array|Int16Array|Int32Array|Int8Array|Uint16Array|Uint32Array|Uint8Array|Uint8ClampedArray site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_2]]}] {
// CHECK-NEXT: b0(v0: undefined|null|Float32Array|Float64Array|Int16Array|Int32Array|Int8Array|Uint16Array|Uint32Array|Uint8Array|Uint8ClampedArray):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_3]]}
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_4]]}
// CHECK-NEXT: Jump -> next b2(v2, v4)
// CHECK-NEXT: b2(v5: number, v6: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = Convert v6 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v0 key="length"
// CHECK-NEXT: v10 = Convert v9 declared={type=number site=[[w_5]]} illTypedCause=Assertion
// CHECK-NEXT: v11 = Less v8, v10
// CHECK-NEXT: Branch v11 -> taken b3(| 0), notTaken b6(| 0)
// CHECK-NEXT: b3(v12):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v13 = Convert v12 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v14 = ElemGet v0, v13
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|number site=[[w_6]]} illTypedCause=FromLooseType
// CHECK-NEXT: v16 = Add v5, v15
// CHECK-NEXT: v17 = Convert v16 declared={type=number site=[[w_3]]}
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v18 = Increment v13
// CHECK-NEXT: v19 = Convert v18 declared={type=number site=[[w_4]]}
// CHECK-NEXT: Jump -> next b2(v17, v19)
// CHECK-NEXT: b6(v20):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v21 = Convert v5 declared={type=number site=[[w_2]]}
// CHECK-NEXT: Return v21
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sumOfHalves"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Float16Array site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_8]]}] {
// CHECK-NEXT: b0(v0: undefined|null|Float16Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = ElemGet v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v4 = Integer integer=1
// CHECK-NEXT: v5 = ElemGet v0, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v7 = Add v3, v6
// CHECK-NEXT: v8 = Convert v7 declared={type=number site=[[w_8]]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sumOfBig"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|BigInt64Array|BigUint64Array site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|bigint site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|BigInt64Array|BigUint64Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = ElemGet v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|bigint site=[[w_11]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = Integer integer=1
// CHECK-NEXT: v5 = ElemGet v0, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|bigint site=[[w_12]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: v7 = Add v3, v6
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|bigint site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="lengthOfLast"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|string> site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_14]]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|string>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="length"
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_15]]} illTypedCause=Assertion
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Sub v2, v3
// CHECK-NEXT: v5 = ElemGet v0, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v7 = PropGet v6 key="length"
// CHECK-NEXT: v8 = Convert v7 declared={type=number site=[[w_14]]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
