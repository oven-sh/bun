// Loops whose counter goes down, and loops with two counters that go towards each other: a view is reversed in place, copied in the opposite order into another view of the same buffer,
// folded onto itself. Every kind of element, every length from 0 to 150, views that begin at any element, and views that lie over each other at every distance.
const buffer = new ArrayBuffer(4096);
const bytes = new Uint8Array(buffer);

function fill(seed: number): void {
  let state = seed | 1;
  for (let k = 0; k < bytes.length; k++) {
    state = (Math.imul(state, 1103515245) + 12345) | 0;
    bytes[k] = state >>> 16;
  }
}

function fillWithSmallNumbers(view: Float32Array | Float64Array, seed: number): void {
  for (let k = 0; k < view.length; k++) view[k] = k % 7 === 3 ? -0 : ((k * 37 + seed) % 1001) / 8 - 60;
}

function digest(): number {
  let sum = 0;
  for (let k = 0; k < bytes.length; k++) sum = (Math.imul(sum, 31) + bytes[k]!) | 0;
  return sum;
}

function reverseInt8(list: Int8Array): void {
  for (let low = 0, high = list.length - 1; low < high; low++, high--) {
    const kept = list[low]!;
    list[low] = list[high]!;
    list[high] = kept;
  }
}
function reverseUint8(list: Uint8Array): void {
  for (let low = 0, high = list.length - 1; low < high; low++, high--) {
    const kept = list[low]!;
    list[low] = list[high]!;
    list[high] = kept;
  }
}
function reverseUint16(list: Uint16Array): void {
  for (let low = 0, high = list.length - 1; low < high; low++, high--) {
    const kept = list[low]!;
    list[low] = list[high]!;
    list[high] = kept;
  }
}
function reverseInt32(list: Int32Array): void {
  for (let low = 0, high = list.length - 1; low < high; low++, high--) {
    const kept = list[low]!;
    list[low] = list[high]!;
    list[high] = kept;
  }
}
function reverseFloat32(list: Float32Array): void {
  for (let low = 0, high = list.length - 1; low < high; low++, high--) {
    const kept = list[low]!;
    list[low] = list[high]!;
    list[high] = kept;
  }
}
function reverseFloat64(list: Float64Array): void {
  for (let low = 0, high = list.length - 1; low < high; low++, high--) {
    const kept = list[low]!;
    list[low] = list[high]!;
    list[high] = kept;
  }
}
function reverseUpToTheMiddleInt32(list: Int32Array): void {
  for (let low = 0, high = list.length - 1; low <= high; low++, high--) {
    const kept = list[low]!;
    list[low] = list[high]! + 1;
    list[high] = kept - 1;
  }
}
function reverseWithOneCounterInt32(list: Int32Array): void {
  const length = list.length;
  for (let k = 0; k < length >> 1; k++) {
    const kept = list[k]!;
    list[k] = list[length - 1 - k]!;
    list[length - 1 - k] = kept;
  }
}
function foldUint8(list: Uint8Array): void {
  for (let low = 0, high = list.length - 1; low < high; low++, high--) list[low] = list[low]! + list[high]!;
}
function foldUpwardUint8(list: Uint8Array): void {
  for (let low = 0, high = list.length - 1; low < high; low++, high--) list[high] = list[low]! ^ list[high]!;
}
function foldBesideInt16(list: Int16Array): void {
  for (let low = 0, high = list.length - 1; low < high; low++, high--) list[low + 1] = list[high]!;
}
function foldBelowInt16(list: Int16Array): void {
  for (let low = 1, high = list.length - 1; low < high; low++, high--) list[low - 1] = list[high]!;
}

function copyInOppositeOrderUint8(to: Uint8Array, from: Uint8Array): void {
  for (let k = 0, other = from.length - 1; k < from.length; k++, other--) to[k] = from[other]!;
}
function copyInOppositeOrderInt32(to: Int32Array, from: Int32Array): void {
  for (let k = 0; k < from.length; k++) to[k] = from[from.length - 1 - k]!;
}
function copyInOppositeOrderDownwardFloat64(to: Float64Array, from: Float64Array): void {
  for (let k = from.length - 1, other = 0; k >= 0; k--, other++) to[k] = from[other]!;
}

function addDownwardUint16(to: Uint16Array, from: Uint16Array): void {
  for (let k = from.length - 1; k >= 0; k--) to[k] = to[k]! + from[k]!;
}
function addDownwardAboveZeroInt32(to: Int32Array, from: Int32Array): void {
  for (let k = from.length - 1; k > 0; k--) to[k] = to[k]! - from[k]!;
}
function moveUpDownwardUint8(list: Uint8Array, by: number): void {
  for (let k = list.length - 1 - by; k >= 0; k--) list[k + by] = list[k]!;
}
function moveDownDownwardUint8(list: Uint8Array, by: number): void {
  for (let k = list.length - 1 - by; k >= 0; k--) list[k] = list[k + by]!;
}
function scaleDownwardFloat64(list: Float64Array, factor: number): void {
  for (let k = list.length - 1; k >= 0; k--) list[k] = list[k]! * factor;
}

{
  let sum = 0;
  for (let first = 0; first < 5; first++) {
    for (let length = 0; length <= 150; length++) {
      fill(first * 151 + length);
      reverseInt8(new Int8Array(buffer, first, length));
      reverseUint8(new Uint8Array(buffer, 200 + first, length));
      reverseUint16(new Uint16Array(buffer, 400 + first * 2, length));
      reverseInt32(new Int32Array(buffer, 800 + first * 4, length));
      reverseUpToTheMiddleInt32(new Int32Array(buffer, 1600 + first * 4, length));
      reverseWithOneCounterInt32(new Int32Array(buffer, 2400 + first * 4, length));
      foldUint8(new Uint8Array(buffer, 3100 + first, length));
      foldUpwardUint8(new Uint8Array(buffer, 3300 + first, length));
      foldBesideInt16(new Int16Array(buffer, 3500 + first * 2, length));
      foldBelowInt16(new Int16Array(buffer, 3780 + first * 2, length));
      sum = (Math.imul(sum, 33) + digest()) | 0;
    }
  }
  console.log("both ends of integers", sum);
}

{
  let sum = 0;
  const singles = new Float32Array(buffer, 0, 512);
  const doubles = new Float64Array(buffer, 2048, 256);
  for (let first = 0; first < 5; first++) {
    for (let length = 0; length <= 150; length++) {
      fillWithSmallNumbers(singles, first + length);
      fillWithSmallNumbers(doubles, first - length);
      reverseFloat32(new Float32Array(buffer, first * 4, length));
      reverseFloat64(new Float64Array(buffer, 2048 + first * 8, length));
      scaleDownwardFloat64(new Float64Array(buffer, 2048 + 1280 + first * 8, length >> 1), length & 1 ? -0.5 : 4);
      sum = (Math.imul(sum, 33) + digest()) | 0;
    }
  }
  console.log("both ends of numbers", sum);
}

{
  let sum = 0;
  const doubles = new Float64Array(buffer, 2048, 256);
  for (let distance = -40; distance <= 40; distance++) {
    for (let length = 0; length <= 70; length++) {
      fill(distance * 71 + length);
      fillWithSmallNumbers(doubles, distance + length);
      copyInOppositeOrderUint8(new Uint8Array(buffer, 43 + distance, length), new Uint8Array(buffer, 43, length));
      copyInOppositeOrderInt32(new Int32Array(buffer, 400 + distance * 4, length), new Int32Array(buffer, 400, length));
      copyInOppositeOrderDownwardFloat64(new Float64Array(buffer, 2048 + 400 + distance * 8, length), new Float64Array(buffer, 2048 + 400, length));
      addDownwardUint16(new Uint16Array(buffer, 1002 + distance * 2, length), new Uint16Array(buffer, 1002, length));
      addDownwardAboveZeroInt32(new Int32Array(buffer, 1500 + distance * 4, length), new Int32Array(buffer, 1500, length));
      sum = (Math.imul(sum, 33) + digest()) | 0;
    }
  }
  console.log("views that lie over each other", sum);
}

{
  let sum = 0;
  for (let length = 0; length <= 90; length++) {
    for (let by = 0; by <= 40; by++) {
      fill(length * 41 + by);
      moveUpDownwardUint8(new Uint8Array(buffer, 7, length), by);
      moveDownDownwardUint8(new Uint8Array(buffer, 207, length), by);
      sum = (Math.imul(sum, 33) + digest()) | 0;
    }
  }
  console.log("one view moved", sum);
}
