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
