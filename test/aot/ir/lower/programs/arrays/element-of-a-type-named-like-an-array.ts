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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Float32Array|Float64Array|Int16Array|Int32Array|Int8Array|Uint16Array|Uint32Array|Uint8Array|Uint8ClampedArray flags=[OmitsNull, OmitsUndefined]}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: undefined|null|Float32Array|Float64Array|Int16Array|Int32Array|Int8Array|Uint16Array|Uint32Array|Uint8Array|Uint8ClampedArray):
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number}
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v2, v4)
// CHECK-NEXT: b1(v5: number, v6: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = PropGet v0 key="length"
// CHECK-NEXT: v9 = Less v6, v8
// CHECK-NEXT: Branch v9 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v10 = ElemGet v0, v6
// CHECK-NEXT: v11 = Add v5, v10
// CHECK-NEXT: v12 = Convert v11 declared={type=number}
// CHECK-NEXT: v13 = Increment v6
// CHECK-NEXT: v14 = Convert v13 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v12, v14)
// CHECK-NEXT: b3():
// CHECK-NEXT: v15 = Convert v5 declared={type=number}
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sumOfHalves"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Float16Array flags=[OmitsNull, OmitsUndefined]}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: undefined|null|Float16Array):
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = ElemGet v0, v1
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = ElemGet v0, v3
// CHECK-NEXT: v5 = Add v2, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=number}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sumOfBig"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|BigInt64Array|BigUint64Array flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|bigint flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|BigInt64Array|BigUint64Array):
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = ElemGet v0, v1
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = ElemGet v0, v3
// CHECK-NEXT: v5 = Add v2, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|bigint flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="lengthOfLast"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|string>):
// CHECK-NEXT: v1 = PropGet v0 key="length"
// CHECK-NEXT: v2 = Integer integer=1
// CHECK-NEXT: v3 = Sub v1, v2
// CHECK-NEXT: v4 = ElemGet v0, v3
// CHECK-NEXT: v5 = PropGet v4 key="length"
// CHECK-NEXT: v6 = Convert v5 declared={type=number}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
