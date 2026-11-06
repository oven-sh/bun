// Strided indexes into typed arrays and lists.
const firsts = [0, 1, -1, 3, -5, 69, 70, 2147483647, -2147483648];
const strides = [0, 1, -1, 2, -2, 3, 7, -7, 16, 65536, 1073741824, 2147483647, -2147483648];
const counts = [0, 1, 2, 5, 16, 17, 71];

function mix(sum: number, value: number | undefined): number {
  return (Math.imul(sum, 31) + (value === undefined ? -7 : value)) | 0;
}

function readUp(view: Int32Array, first: number, stride: number, count: number): number {
  first |= 0;
  stride |= 0;
  count |= 0;
  let sum = 0;
  for (let k = 0; k < count; k++) sum = mix(sum, view[first + k * stride]);
  return sum;
}

function readUpWrapping(view: Int32Array, first: number, stride: number, count: number): number {
  first |= 0;
  stride |= 0;
  count |= 0;
  let sum = 0;
  for (let k = 0; k < count; k++) sum = mix(sum, view[(first + Math.imul(k, stride)) | 0]);
  return sum;
}

function readDown(view: Int32Array, first: number, stride: number, count: number): number {
  first |= 0;
  stride |= 0;
  count |= 0;
  let sum = 0;
  for (let k = count - 1; k >= 0; k--) sum = mix(sum, view[first + k * stride]);
  return sum;
}

function readDownWrapping(view: Int32Array, first: number, stride: number, count: number): number {
  first |= 0;
  stride |= 0;
  count |= 0;
  let sum = 0;
  for (let k = count; k > 0; k--) sum = mix(sum, view[(first + Math.imul(k, stride)) | 0]);
  return sum;
}

function readInclusive(view: Int32Array, first: number, stride: number, count: number): number {
  first |= 0;
  stride |= 0;
  count |= 0;
  let sum = 0;
  for (let k = 0; k <= count; k++) sum = mix(sum, view[(first + Math.imul(k, stride)) | 0]);
  return sum;
}

function readEveryThird(view: Int32Array, first: number, stride: number, count: number): number {
  first |= 0;
  stride |= 0;
  count |= 0;
  let sum = 0;
  for (let k = 0; k < count; k += 3) sum = mix(sum, view[(first + Math.imul(k, stride)) | 0]);
  return sum;
}

function readFrom(view: Int32Array, first: number, stride: number, count: number): number {
  first |= 0;
  stride |= 0;
  count |= 0;
  let sum = 0;
  for (let k = first % 97 | 0; k < count; k++) sum = mix(sum, view[(Math.imul(k, stride) + 2) | 0]);
  return sum;
}

function readAtLeastOnce(view: Int32Array, first: number, stride: number, count: number): number {
  first |= 0;
  stride |= 0;
  count |= 0;
  let sum = 0;
  let k = first % 97 | 0;
  do sum = mix(sum, view[(Math.imul(k, stride) + 2) | 0]);
  while (++k < count);
  return sum;
}

function readDownAtLeastOnce(view: Int32Array, first: number, stride: number, count: number): number {
  first |= 0;
  stride |= 0;
  count |= 0;
  let sum = 0;
  let k = count;
  do sum = mix(sum, view[(first + Math.imul(k, stride)) | 0]);
  while (--k > 3);
  return sum;
}

function readNeighbors(view: Int32Array, first: number, stride: number, count: number): number {
  first |= 0;
  stride |= 0;
  count |= 0;
  let sum = 0;
  for (let k = 0; k < count; k++) {
    const at = (first + Math.imul(k, stride)) | 0;
    sum = mix(mix(mix(sum, view[(at - 1) | 0]), view[at]), view[(at + 2) | 0]);
  }
  return sum;
}

function readChannels(view: Uint8Array, first: number, count: number): number {
  first |= 0;
  count |= 0;
  let sum = 0;
  for (let k = 0; k < count; k++) sum = mix(mix(mix(sum, view[4 * k + first]), view[4 * k + first + 1]), view[4 * k + first + 2]);
  return sum;
}

function readBackward(view: Float64Array, last: number, count: number): number {
  last |= 0;
  count |= 0;
  let sum = 0;
  for (let k = 0; k < count; k++) sum = mix(sum, view[last - 2 * k]);
  return sum;
}

function storeUp(view: Int32Array, first: number, stride: number, count: number): number {
  first |= 0;
  stride |= 0;
  count |= 0;
  for (let k = 0; k < count; k++) view[(first + Math.imul(k, stride)) | 0] = k + 100;
  let sum = 0;
  for (let k = 0; k < view.length; k++) {
    sum = mix(sum, view[k]);
    view[k] = k + 1;
  }
  return sum;
}

function readList(list: number[], first: number, stride: number, count: number): number {
  first |= 0;
  stride |= 0;
  count |= 0;
  let sum = 0;
  for (let k = 0; k < count; k++) sum = mix(sum, list[(first + Math.imul(k, stride)) | 0]);
  return sum;
}

function sumRows(view: Float64Array, width: number, height: number): number {
  width |= 0;
  height |= 0;
  let sum = 0;
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) sum = mix(sum, view[r * width + c]);
  return sum;
}

function sumColumns(view: Float64Array, width: number, height: number): number {
  width |= 0;
  height |= 0;
  let sum = 0;
  for (let c = 0; c < width; c++) for (let r = 0; r < height; r++) sum = mix(sum, view[r * width + c]);
  return sum;
}

const readers = { readUp, readUpWrapping, readDown, readDownWrapping, readInclusive, readEveryThird, readFrom, readAtLeastOnce, readDownAtLeastOnce, readNeighbors, storeUp };

for (const [name, reader] of Object.entries(readers)) {
  for (const stride of strides) {
    let sum = 0;
    for (let length = 0; length <= 70; length++) {
      const view = Int32Array.from({ length }, (_, k) => k + 1);
      for (const first of firsts) for (const count of counts) sum = mix(sum, reader(view, first, stride, count));
    }
    console.log(name, stride, sum);
  }
}

for (const stride of strides) {
  let sum = 0;
  for (let length = 0; length <= 70; length++) {
    const list = Array.from({ length }, (_, k) => k + 1);
    for (const first of firsts) for (const count of counts) sum = mix(sum, readList(list, first, stride, count));
  }
  console.log("readList", stride, sum);
}

for (let length = 0; length <= 70; length++) {
  const bytes = Uint8Array.from({ length }, (_, k) => k + 1);
  const numbers = Float64Array.from({ length }, (_, k) => k + 1);
  let sum = 0;
  for (const first of firsts) {
    for (const count of counts) sum = mix(mix(sum, readChannels(bytes, first, count)), readBackward(numbers, first, count));
  }
  for (let width = 0; width <= 9; width++) {
    for (let height = 0; height <= 9; height++) sum = mix(mix(sum, sumRows(numbers, width, height)), sumColumns(numbers, width, height));
  }
  console.log("length", length, sum);
}

function filled(buffer: ArrayBuffer): Int32Array {
  const view = new Int32Array(buffer);
  for (let k = 0; k < view.length; k++) view[k] = k + 1;
  return view;
}

function readWhileResizing(length: number, at: number, to: number, stride: number, count: number): number {
  const buffer = new ArrayBuffer(length * 4, { maxByteLength: 400 });
  const view = filled(buffer);
  let sum = 0;
  for (let k = 0; k < count; k++) {
    if (k === at) buffer.resize(to * 4);
    sum = mix(sum, view[k * stride + 1]);
  }
  return mix(sum, view.length);
}

function readFixedLengthViewWhileResizing(length: number, at: number, to: number, stride: number, count: number): number {
  const buffer = new ArrayBuffer(length * 4, { maxByteLength: 400 });
  filled(buffer);
  const view = new Int32Array(buffer, 0, length);
  let sum = 0;
  for (let k = 0; k < count; k++) {
    if (k === at) buffer.resize(to * 4);
    sum = mix(sum, view[k * stride + 1]);
  }
  return mix(sum, view.length);
}

function readWhileDetaching(length: number, at: number, stride: number, count: number): number {
  const buffer = new ArrayBuffer(length * 4);
  const view = filled(buffer);
  let sum = 0;
  for (let k = 0; k < count; k++) {
    if (k === at) buffer.transfer();
    sum = mix(sum, view[k * stride + 1]);
  }
  return mix(sum, view.length);
}

function storeWhileDetaching(length: number, at: number, stride: number, count: number): number {
  const buffer = new ArrayBuffer(length * 4);
  const view = filled(buffer);
  let kept: ArrayBuffer = buffer;
  for (let k = 0; k < count; k++) {
    if (k === at) kept = buffer.transfer();
    view[k * stride + 1] = -k;
  }
  let sum = view.length;
  for (const value of new Int32Array(kept)) sum = mix(sum, value);
  return sum;
}

function readWhileCallbackResizes(view: Int32Array, stride: number, count: number, each: (k: number) => void): number {
  let sum = 0;
  for (let k = 0; k < count; k++) {
    each(k);
    sum = mix(sum, view[k * stride + 1]);
  }
  return mix(sum, view.length);
}

for (const stride of [0, 1, 2, 3, 5]) {
  let sum = 0;
  for (const length of [0, 1, 8, 33, 70]) {
    for (const at of [0, 1, 4, 15, 16, 99]) {
      for (const count of [0, 1, 5, 16, 24]) {
        for (const to of [0, 3, 40, 100]) {
          sum = mix(sum, readWhileResizing(length, at, to, stride, count));
          sum = mix(sum, readFixedLengthViewWhileResizing(length, at, to, stride, count));
          const buffer = new ArrayBuffer(length * 4, { maxByteLength: 400 });
          sum = mix(sum, readWhileCallbackResizes(filled(buffer), stride, count, k => {
            if (k === at) buffer.resize(to * 4);
          }));
        }
        sum = mix(sum, readWhileDetaching(length, at, stride, count));
        sum = mix(sum, storeWhileDetaching(length, at, stride, count));
      }
    }
  }
  console.log("resized or detached", stride, sum);
}
