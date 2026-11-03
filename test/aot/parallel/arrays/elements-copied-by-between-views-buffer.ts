// Loops that copy elements one by one between two views of one buffer. Where the views lie over each other an element that was stored may be the next one that is loaded, so what comes out depends on
// the order of the loads and stores: every distance between the views from forty elements below to forty above, every length from 0 to 70, views that begin at any element of the buffer,
// every kind of element, a target that is shorter or longer than the source, counters that go up and go down, and indices beside the counter.
const buffer = new ArrayBuffer(2048);
const bytes = new Uint8Array(buffer);

function fill(seed: number): void {
  let state = seed | 1;
  for (let k = 0; k < bytes.length; k++) {
    state = (Math.imul(state, 1103515245) + 12345) | 0;
    bytes[k] = state >>> 16;
  }
}

// Numbers that every kind of element holds exactly, so that no element is a NaN whose bits could tell.
function fillWithSmallNumbers(view: Float32Array | Float64Array, seed: number): void {
  for (let k = 0; k < view.length; k++) view[k] = k % 7 === 3 ? -0 : ((k * 37 + seed) % 1001) / 8 - 60;
}

function digest(): number {
  let sum = 0;
  for (let k = 0; k < bytes.length; k++) sum = (Math.imul(sum, 31) + bytes[k]!) | 0;
  return sum;
}

function copyInt8(to: Int8Array, from: Int8Array): void {
  for (let k = 0; k < from.length; k++) to[k] = from[k]!;
}
function copyUint8(to: Uint8Array, from: Uint8Array): void {
  for (let k = 0; k < from.length; k++) to[k] = from[k]!;
}
function copyUint8Clamped(to: Uint8ClampedArray, from: Uint8ClampedArray): void {
  for (let k = 0; k < from.length; k++) to[k] = from[k]!;
}
function copyInt16(to: Int16Array, from: Int16Array): void {
  for (let k = 0; k < from.length; k++) to[k] = from[k]!;
}
function copyUint16(to: Uint16Array, from: Uint16Array): void {
  for (let k = 0; k < from.length; k++) to[k] = from[k]!;
}
function copyInt32(to: Int32Array, from: Int32Array): void {
  for (let k = 0; k < from.length; k++) to[k] = from[k]!;
}
function copyUint32(to: Uint32Array, from: Uint32Array): void {
  for (let k = 0; k < from.length; k++) to[k] = from[k]!;
}
function copyFloat32(to: Float32Array, from: Float32Array): void {
  for (let k = 0; k < from.length; k++) to[k] = from[k]!;
}
function copyFloat64(to: Float64Array, from: Float64Array): void {
  for (let k = 0; k < from.length; k++) to[k] = from[k]!;
}
function copyBigInt64(to: BigInt64Array, from: BigInt64Array): void {
  for (let k = 0; k < from.length; k++) to[k] = from[k]!;
}

function copyDownwardUint8(to: Uint8Array, from: Uint8Array): void {
  for (let k = from.length - 1; k >= 0; k--) to[k] = from[k]!;
}
function copyDownwardInt32(to: Int32Array, from: Int32Array): void {
  for (let k = from.length - 1; k >= 0; k--) to[k] = from[k]!;
}
function copyDownwardFloat64(to: Float64Array, from: Float64Array): void {
  for (let k = from.length - 1; k >= 0; k--) to[k] = from[k]!;
}

function copySomeUint8(to: Uint8Array, from: Uint8Array, first: number, end: number): void {
  for (let k = first; k < end; k++) to[k] = from[k]!;
}
function copySomeInt16(to: Int16Array, from: Int16Array, first: number, end: number): void {
  for (let k = first; k < end; k++) to[k] = from[k]!;
}
function copyUpToAndWithUint8(to: Uint8Array, from: Uint8Array, last: number): void {
  for (let k = 0; k <= last; k++) to[k] = from[k]!;
}

function moveDownUint8(list: Uint8Array, by: number): void {
  for (let k = 0; k + by < list.length; k++) list[k] = list[k + by]!;
}
function moveUpUint8(list: Uint8Array, by: number): void {
  for (let k = 0; k + by < list.length; k++) list[k + by] = list[k]!;
}
function moveDownByOneInt32(list: Int32Array): void {
  for (let k = 0; k + 1 < list.length; k++) list[k] = list[k + 1]!;
}
function moveUpByOneInt32(list: Int32Array): void {
  for (let k = 1; k < list.length; k++) list[k] = list[k - 1]!;
}
function moveUpByThreeInt16(list: Int16Array): void {
  for (let k = 3; k < list.length; k++) list[k] = list[k - 3]!;
}
function moveUpByFourInt32(list: Int32Array): void {
  for (let k = 4; k < list.length; k++) list[k] = list[k - 4]!;
}
function moveUpBySixteenUint8(list: Uint8Array): void {
  for (let k = 16; k < list.length; k++) list[k] = list[k - 16]!;
}
function moveUpByFifteenUint8(list: Uint8Array): void {
  for (let k = 15; k < list.length; k++) list[k] = list[k - 15]!;
}

function swapUint8(left: Uint8Array, right: Uint8Array): void {
  for (let k = 0; k < left.length; k++) {
    const kept = left[k]!;
    left[k] = right[k]!;
    right[k] = kept;
  }
}
function copyToTwoInt32(first: Int32Array, second: Int32Array, from: Int32Array): void {
  for (let k = 0; k < from.length; k++) {
    first[k] = from[k]!;
    second[k] = from[k]!;
  }
}

function everyPlace(name: string, size: number, copy: (to: number, from: number, length: number) => void): void {
  let sum = 0;
  for (const first of [40, 41, 43, 47, 56]) {
    for (let distance = -40; distance <= 40; distance++) {
      for (let length = 0; length <= 70; length++) {
        fill(first * 131 + distance * 7 + length);
        copy((first + distance) * size, first * size, length);
        sum = (Math.imul(sum, 33) + digest()) | 0;
      }
    }
  }
  console.log(name, sum);
}

function everyPlaceOfNumbers(name: string, whole: Float32Array | Float64Array, copy: (to: number, from: number, length: number) => void): void {
  let sum = 0;
  for (const first of [40, 41, 43]) {
    for (let distance = -40; distance <= 40; distance++) {
      for (let length = 0; length <= 70; length++) {
        fillWithSmallNumbers(whole, first + distance + length);
        copy((first + distance) * whole.BYTES_PER_ELEMENT, first * whole.BYTES_PER_ELEMENT, length);
        sum = (Math.imul(sum, 33) + digest()) | 0;
      }
    }
  }
  console.log(name, sum);
}

everyPlace("Int8Array", 1, (to, from, length) => copyInt8(new Int8Array(buffer, to, length), new Int8Array(buffer, from, length)));
everyPlace("Uint8Array", 1, (to, from, length) => copyUint8(new Uint8Array(buffer, to, length), new Uint8Array(buffer, from, length)));
everyPlace("Uint8ClampedArray", 1, (to, from, length) => copyUint8Clamped(new Uint8ClampedArray(buffer, to, length), new Uint8ClampedArray(buffer, from, length)));
everyPlace("Int16Array", 2, (to, from, length) => copyInt16(new Int16Array(buffer, to, length), new Int16Array(buffer, from, length)));
everyPlace("Uint16Array", 2, (to, from, length) => copyUint16(new Uint16Array(buffer, to, length), new Uint16Array(buffer, from, length)));
everyPlace("Int32Array", 4, (to, from, length) => copyInt32(new Int32Array(buffer, to, length), new Int32Array(buffer, from, length)));
everyPlace("Uint32Array", 4, (to, from, length) => copyUint32(new Uint32Array(buffer, to, length), new Uint32Array(buffer, from, length)));
everyPlace("BigInt64Array", 8, (to, from, length) => copyBigInt64(new BigInt64Array(buffer, to, length), new BigInt64Array(buffer, from, length)));
everyPlaceOfNumbers("Float32Array", new Float32Array(buffer), (to, from, length) => copyFloat32(new Float32Array(buffer, to, length), new Float32Array(buffer, from, length)));
everyPlaceOfNumbers("Float64Array", new Float64Array(buffer), (to, from, length) => copyFloat64(new Float64Array(buffer, to, length), new Float64Array(buffer, from, length)));
everyPlace("Uint8Array downward", 1, (to, from, length) => copyDownwardUint8(new Uint8Array(buffer, to, length), new Uint8Array(buffer, from, length)));
everyPlace("Int32Array downward", 4, (to, from, length) => copyDownwardInt32(new Int32Array(buffer, to, length), new Int32Array(buffer, from, length)));
everyPlaceOfNumbers("Float64Array downward", new Float64Array(buffer), (to, from, length) => copyDownwardFloat64(new Float64Array(buffer, to, length), new Float64Array(buffer, from, length)));
everyPlace("Uint8Array swapped", 1, (to, from, length) => swapUint8(new Uint8Array(buffer, to, length), new Uint8Array(buffer, from, length)));

{
  let sum = 0;
  for (let toLength = 0; toLength <= 70; toLength += 3) {
    for (let fromLength = 0; fromLength <= 70; fromLength++) {
      fill(toLength * 71 + fromLength);
      copyUint8(new Uint8Array(buffer, 301, toLength), new Uint8Array(buffer, 517, fromLength));
      copyInt32(new Int32Array(buffer, 1004, toLength), new Int32Array(buffer, 1404, fromLength));
      sum = (Math.imul(sum, 33) + digest()) | 0;
    }
  }
  console.log("lengths that differ", sum);
}

{
  let sum = 0;
  for (let first = -3; first <= 40; first++) {
    for (let end = -3; end <= 75; end++) {
      fill(first * 79 + end);
      copySomeUint8(new Uint8Array(buffer, 33, 70), new Uint8Array(buffer, 41, 70), first, end);
      copySomeInt16(new Int16Array(buffer, 1002, 70), new Int16Array(buffer, 998, 70), first, end);
      copyUpToAndWithUint8(new Uint8Array(buffer, 601, 70), new Uint8Array(buffer, 599, 70), end);
      sum = (Math.imul(sum, 33) + digest()) | 0;
    }
  }
  console.log("parts", sum);
}

{
  let sum = 0;
  for (let length = 0; length <= 90; length++) {
    for (let by = 0; by <= 40; by++) {
      fill(length * 41 + by);
      moveDownUint8(new Uint8Array(buffer, 7, length), by);
      moveUpUint8(new Uint8Array(buffer, 207, length), by);
      sum = (Math.imul(sum, 33) + digest()) | 0;
    }
    fill(length);
    moveDownByOneInt32(new Int32Array(buffer, 4, length));
    moveUpByOneInt32(new Int32Array(buffer, 404, length));
    moveUpByThreeInt16(new Int16Array(buffer, 802, length));
    moveUpByFourInt32(new Int32Array(buffer, 1004, length));
    moveUpBySixteenUint8(new Uint8Array(buffer, 1401, length));
    moveUpByFifteenUint8(new Uint8Array(buffer, 1501, length));
    sum = (Math.imul(sum, 33) + digest()) | 0;
  }
  console.log("one view moved", sum);
}

{
  let sum = 0;
  for (let first = -6; first <= 6; first++) {
    for (let second = -6; second <= 6; second++) {
      for (let length = 0; length <= 40; length++) {
        fill(first * 13 + second * 169 + length);
        copyToTwoInt32(new Int32Array(buffer, 400 + first * 4, length), new Int32Array(buffer, 400 + second * 4, length), new Int32Array(buffer, 400, length));
        sum = (Math.imul(sum, 33) + digest()) | 0;
      }
    }
  }
  console.log("two targets", sum);
}
