// A loop that stores many streams into one view, the streams a power of two apart, runs once for each group of streams.
function hash(view) {
  if (view.buffer.detached) return "detached";
  const bytes = new Uint8Array(view.buffer, 0);
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) sum = (Math.imul(sum, 31) + bytes[i]) | 0;
  return view.length + ":" + sum;
}

function Noise(table) {
  this.table = table;
}
Noise.prototype.integers = function () {
  var factor = 1, register = 0x7fff, shifted = 0x3fff;
  for (var index = 0; index < 0x1000; ++index) {
    factor = 1 - (register & 1);
    this.table[0x1000 | index] = factor;
    this.table[0x2000 | index] = factor * 2;
    this.table[0x3000 | index] = factor * 3;
    this.table[0x4000 | index] = factor * 4;
    this.table[0x5000 | index] = factor * 5;
    this.table[0x6000 | index] = factor * 6;
    this.table[0x7000 | index] = factor * 7;
    this.table[0x8000 | index] = factor * 8;
    this.table[0x9000 | index] = factor * 9;
    this.table[0xa000 | index] = factor * 10;
    this.table[0xb000 | index] = factor * 11;
    this.table[0xc000 | index] = factor * 12;
    this.table[0xd000 | index] = factor * 13;
    this.table[0xe000 | index] = factor * 14;
    this.table[0xf000 | index] = factor * 15;
    shifted = register >> 1;
    register = shifted | (((shifted ^ register) & 1) << 14);
  }
  return [factor, register, shifted, index].join();
};
Noise.prototype.fractions = function () {
  var view = this.table, value = 1.5, sign = -0;
  for (var i = 1; i <= 1000; i++) {
    view[i] = value;
    view[4096 + i] = sign;
    view[8192 + i] = -value;
    value = value * 1.0078125 - 0.25;
    sign = -sign;
    view[12288 + i] = value;
    view[16384 + i] = i / 3;
    view[20480 + i] = value + sign;
    view[24576 + i] = NaN;
    view[28672 + i] = i;
    view[32768 + i] = undefined;
    view[36864 + i] = true;
  }
  return [value, sign, i].map(x => (Object.is(x, -0) ? "-0" : String(x))).join();
};
// Streams that meet, and the same place stored twice in one turn, keep the order of the text.
Noise.prototype.meeting = function () {
  var view = this.table, value = 1;
  for (var i = 0; i < 4100; i++) {
    view[i] = value; view[i + 4096] = value + 1; view[i + 8192] = value + 2; view[i + 12288] = value + 3;
    view[i + 16384] = value + 4; view[i + 20480] = value + 5; view[i + 24576] = value + 6; view[i + 28672] = value + 7;
    value = (value * 5 + 3) & 0xff;
  }
  for (i = 0; i < 100; i++) {
    view[i] = value; view[i + 4096] = value + 1; view[i + 8192] = value + 2; view[i + 12288] = value + 3;
    view[i + 8192] = value + 4; view[i + 20480] = value + 5; view[i + 24576] = value + 6; view[i + 28672] = value + 7;
    value = (value * 5 + 3) & 0xff;
  }
  return value;
};
// What a turn reads out of the view was stored by the turns before.
Noise.prototype.reading = function () {
  var view = this.table, value = 1;
  for (var i = 0; i < 4096; i++) {
    view[i] = value; view[i + 4096] = value + 1; view[i + 8192] = value + 2; view[i + 12288] = value + 3;
    view[i + 16384] = value + 4; view[i + 20480] = value + 5; view[i + 24576] = value + 6; view[i + 28672] = value + 7;
    value = (view[(i * 7) & 0x7fff] + 3) & 0xff;
  }
  return value;
};
function Samples(table) {
  this.table = table;
}
Samples.prototype.integers = function () {
  var factor = 1, register = 0x7fff, shifted = 0x3fff;
  for (var index = 0; index < 0x1000; ++index) {
    factor = 1 - (register & 1);
    this.table[0x1000 | index] = factor;
    this.table[0x2000 | index] = factor * 2;
    this.table[0x3000 | index] = factor * 3;
    this.table[0x4000 | index] = factor * 4;
    this.table[0x5000 | index] = factor * 5;
    this.table[0x6000 | index] = factor * 6;
    this.table[0x7000 | index] = factor * 7;
    this.table[0x8000 | index] = factor * 8;
    this.table[0x9000 | index] = factor * 9;
    this.table[0xa000 | index] = factor * 10;
    this.table[0xb000 | index] = factor * 11;
    this.table[0xc000 | index] = factor * 12;
    this.table[0xd000 | index] = factor * 13;
    this.table[0xe000 | index] = factor * 14;
    this.table[0xf000 | index] = factor * 15;
    shifted = register >> 1;
    register = shifted | (((shifted ^ register) & 1) << 14);
  }
  return [factor, register, shifted, index].join();
};
Samples.prototype.fractions = function () {
  var view = this.table, value = 1.5, sign = -0;
  for (var i = 1; i <= 1000; i++) {
    view[i] = value;
    view[4096 + i] = sign;
    view[8192 + i] = -value;
    value = value * 1.0078125 - 0.25;
    sign = -sign;
    view[12288 + i] = value;
    view[16384 + i] = i / 3;
    view[20480 + i] = value + sign;
    view[24576 + i] = NaN;
    view[28672 + i] = i;
    view[32768 + i] = undefined;
    view[36864 + i] = true;
  }
  return [value, sign, i].map(x => (Object.is(x, -0) ? "-0" : String(x))).join();
};
Samples.prototype.meeting = function () {
  var view = this.table, value = 1;
  for (var i = 0; i < 4100; i++) {
    view[i] = value; view[i + 4096] = value + 1; view[i + 8192] = value + 2; view[i + 12288] = value + 3;
    view[i + 16384] = value + 4; view[i + 20480] = value + 5; view[i + 24576] = value + 6; view[i + 28672] = value + 7;
    value = (value * 5 + 3) & 0xff;
  }
  for (i = 0; i < 100; i++) {
    view[i] = value; view[i + 4096] = value + 1; view[i + 8192] = value + 2; view[i + 12288] = value + 3;
    view[i + 8192] = value + 4; view[i + 20480] = value + 5; view[i + 24576] = value + 6; view[i + 28672] = value + 7;
    value = (value * 5 + 3) & 0xff;
  }
  return value;
};
Samples.prototype.reading = function () {
  var view = this.table, value = 1;
  for (var i = 0; i < 4096; i++) {
    view[i] = value; view[i + 4096] = value + 1; view[i + 8192] = value + 2; view[i + 12288] = value + 3;
    view[i + 16384] = value + 4; view[i + 20480] = value + 5; view[i + 24576] = value + 6; view[i + 28672] = value + 7;
    value = (view[(i * 7) & 0x7fff] + 3) & 0xff;
  }
  return value;
};
function Pixels(table) {
  this.table = table;
}
Pixels.prototype.integers = function () {
  var factor = 1, register = 0x7fff, shifted = 0x3fff;
  for (var index = 0; index < 0x1000; ++index) {
    factor = 1 - (register & 1);
    this.table[0x1000 | index] = factor;
    this.table[0x2000 | index] = factor * 2;
    this.table[0x3000 | index] = factor * 3;
    this.table[0x4000 | index] = factor * 4;
    this.table[0x5000 | index] = factor * 5;
    this.table[0x6000 | index] = factor * 6;
    this.table[0x7000 | index] = factor * 7;
    this.table[0x8000 | index] = factor * 8;
    this.table[0x9000 | index] = factor * 9;
    this.table[0xa000 | index] = factor * 10;
    this.table[0xb000 | index] = factor * 11;
    this.table[0xc000 | index] = factor * 12;
    this.table[0xd000 | index] = factor * 13;
    this.table[0xe000 | index] = factor * 14;
    this.table[0xf000 | index] = factor * 15;
    shifted = register >> 1;
    register = shifted | (((shifted ^ register) & 1) << 14);
  }
  return [factor, register, shifted, index].join();
};
Pixels.prototype.fractions = function () {
  var view = this.table, value = 1.5, sign = -0;
  for (var i = 1; i <= 1000; i++) {
    view[i] = value;
    view[4096 + i] = sign;
    view[8192 + i] = -value;
    value = value * 1.0078125 - 0.25;
    sign = -sign;
    view[12288 + i] = value;
    view[16384 + i] = i / 3;
    view[20480 + i] = value + sign;
    view[24576 + i] = NaN;
    view[28672 + i] = i;
    view[32768 + i] = undefined;
    view[36864 + i] = true;
  }
  return [value, sign, i].map(x => (Object.is(x, -0) ? "-0" : String(x))).join();
};
Pixels.prototype.meeting = function () {
  var view = this.table, value = 1;
  for (var i = 0; i < 4100; i++) {
    view[i] = value; view[i + 4096] = value + 1; view[i + 8192] = value + 2; view[i + 12288] = value + 3;
    view[i + 16384] = value + 4; view[i + 20480] = value + 5; view[i + 24576] = value + 6; view[i + 28672] = value + 7;
    value = (value * 5 + 3) & 0xff;
  }
  for (i = 0; i < 100; i++) {
    view[i] = value; view[i + 4096] = value + 1; view[i + 8192] = value + 2; view[i + 12288] = value + 3;
    view[i + 8192] = value + 4; view[i + 20480] = value + 5; view[i + 24576] = value + 6; view[i + 28672] = value + 7;
    value = (value * 5 + 3) & 0xff;
  }
  return value;
};
Pixels.prototype.reading = function () {
  var view = this.table, value = 1;
  for (var i = 0; i < 4096; i++) {
    view[i] = value; view[i + 4096] = value + 1; view[i + 8192] = value + 2; view[i + 12288] = value + 3;
    view[i + 16384] = value + 4; view[i + 20480] = value + 5; view[i + 24576] = value + 6; view[i + 28672] = value + 7;
    value = (view[(i * 7) & 0x7fff] + 3) & 0xff;
  }
  return value;
};
function Words(table) {
  this.table = table;
}
Words.prototype.integers = function () {
  var factor = 1, register = 0x7fff, shifted = 0x3fff;
  for (var index = 0; index < 0x1000; ++index) {
    factor = 1 - (register & 1);
    this.table[0x1000 | index] = factor;
    this.table[0x2000 | index] = factor * 2;
    this.table[0x3000 | index] = factor * 3;
    this.table[0x4000 | index] = factor * 4;
    this.table[0x5000 | index] = factor * 5;
    this.table[0x6000 | index] = factor * 6;
    this.table[0x7000 | index] = factor * 7;
    this.table[0x8000 | index] = factor * 8;
    this.table[0x9000 | index] = factor * 9;
    this.table[0xa000 | index] = factor * 10;
    this.table[0xb000 | index] = factor * 11;
    this.table[0xc000 | index] = factor * 12;
    this.table[0xd000 | index] = factor * 13;
    this.table[0xe000 | index] = factor * 14;
    this.table[0xf000 | index] = factor * 15;
    shifted = register >> 1;
    register = shifted | (((shifted ^ register) & 1) << 14);
  }
  return [factor, register, shifted, index].join();
};
Words.prototype.fractions = function () {
  var view = this.table, value = 1.5, sign = -0;
  for (var i = 1; i <= 1000; i++) {
    view[i] = value;
    view[4096 + i] = sign;
    view[8192 + i] = -value;
    value = value * 1.0078125 - 0.25;
    sign = -sign;
    view[12288 + i] = value;
    view[16384 + i] = i / 3;
    view[20480 + i] = value + sign;
    view[24576 + i] = NaN;
    view[28672 + i] = i;
    view[32768 + i] = undefined;
    view[36864 + i] = true;
  }
  return [value, sign, i].map(x => (Object.is(x, -0) ? "-0" : String(x))).join();
};
Words.prototype.meeting = function () {
  var view = this.table, value = 1;
  for (var i = 0; i < 4100; i++) {
    view[i] = value; view[i + 4096] = value + 1; view[i + 8192] = value + 2; view[i + 12288] = value + 3;
    view[i + 16384] = value + 4; view[i + 20480] = value + 5; view[i + 24576] = value + 6; view[i + 28672] = value + 7;
    value = (value * 5 + 3) & 0xff;
  }
  for (i = 0; i < 100; i++) {
    view[i] = value; view[i + 4096] = value + 1; view[i + 8192] = value + 2; view[i + 12288] = value + 3;
    view[i + 8192] = value + 4; view[i + 20480] = value + 5; view[i + 24576] = value + 6; view[i + 28672] = value + 7;
    value = (value * 5 + 3) & 0xff;
  }
  return value;
};
Words.prototype.reading = function () {
  var view = this.table, value = 1;
  for (var i = 0; i < 4096; i++) {
    view[i] = value; view[i + 4096] = value + 1; view[i + 8192] = value + 2; view[i + 12288] = value + 3;
    view[i + 16384] = value + 4; view[i + 20480] = value + 5; view[i + 24576] = value + 6; view[i + 28672] = value + 7;
    value = (view[(i * 7) & 0x7fff] + 3) & 0xff;
  }
  return value;
};
function Anything(table) {
  this.table = table;
}
Anything.prototype.integers = function () {
  var factor = 1, register = 0x7fff, shifted = 0x3fff;
  for (var index = 0; index < 0x1000; ++index) {
    factor = 1 - (register & 1);
    this.table[0x1000 | index] = factor;
    this.table[0x2000 | index] = factor * 2;
    this.table[0x3000 | index] = factor * 3;
    this.table[0x4000 | index] = factor * 4;
    this.table[0x5000 | index] = factor * 5;
    this.table[0x6000 | index] = factor * 6;
    this.table[0x7000 | index] = factor * 7;
    this.table[0x8000 | index] = factor * 8;
    this.table[0x9000 | index] = factor * 9;
    this.table[0xa000 | index] = factor * 10;
    this.table[0xb000 | index] = factor * 11;
    this.table[0xc000 | index] = factor * 12;
    this.table[0xd000 | index] = factor * 13;
    this.table[0xe000 | index] = factor * 14;
    this.table[0xf000 | index] = factor * 15;
    shifted = register >> 1;
    register = shifted | (((shifted ^ register) & 1) << 14);
  }
  return [factor, register, shifted, index].join();
};
Anything.prototype.fractions = function () {
  var view = this.table, value = 1.5, sign = -0;
  for (var i = 1; i <= 1000; i++) {
    view[i] = value;
    view[4096 + i] = sign;
    view[8192 + i] = -value;
    value = value * 1.0078125 - 0.25;
    sign = -sign;
    view[12288 + i] = value;
    view[16384 + i] = i / 3;
    view[20480 + i] = value + sign;
    view[24576 + i] = NaN;
    view[28672 + i] = i;
    view[32768 + i] = undefined;
    view[36864 + i] = true;
  }
  return [value, sign, i].map(x => (Object.is(x, -0) ? "-0" : String(x))).join();
};
Anything.prototype.meeting = function () {
  var view = this.table, value = 1;
  for (var i = 0; i < 4100; i++) {
    view[i] = value; view[i + 4096] = value + 1; view[i + 8192] = value + 2; view[i + 12288] = value + 3;
    view[i + 16384] = value + 4; view[i + 20480] = value + 5; view[i + 24576] = value + 6; view[i + 28672] = value + 7;
    value = (value * 5 + 3) & 0xff;
  }
  for (i = 0; i < 100; i++) {
    view[i] = value; view[i + 4096] = value + 1; view[i + 8192] = value + 2; view[i + 12288] = value + 3;
    view[i + 8192] = value + 4; view[i + 20480] = value + 5; view[i + 24576] = value + 6; view[i + 28672] = value + 7;
    value = (value * 5 + 3) & 0xff;
  }
  return value;
};
Anything.prototype.reading = function () {
  var view = this.table, value = 1;
  for (var i = 0; i < 4096; i++) {
    view[i] = value; view[i + 4096] = value + 1; view[i + 8192] = value + 2; view[i + 12288] = value + 3;
    view[i + 16384] = value + 4; view[i + 20480] = value + 5; view[i + 24576] = value + 6; view[i + 28672] = value + 7;
    value = (view[(i * 7) & 0x7fff] + 3) & 0xff;
  }
  return value;
};
function show(name, number, make) {
  for (const method of ["integers", "fractions", "meeting", "reading"]) {
    try {
      const held = make();
      const said = held[method]();
      console.log(name, number, method, said, hash(held.table));
    } catch (error) {
      console.log(name, number, method, error.constructor.name);
    }
  }
}
[
  () => new Noise(new Int8Array(0x10000)),
  () => new Noise(new Int8Array(0x5001)),
  () => new Noise(new Int8Array(0)),
  () => new Noise(new Int8Array(new SharedArrayBuffer(0x10000 * Int8Array.BYTES_PER_ELEMENT))),
  () => new Noise(new Int8Array(new ArrayBuffer(0x4000 * Int8Array.BYTES_PER_ELEMENT, { maxByteLength: 0x10000 * Int8Array.BYTES_PER_ELEMENT }))),
  () => {
    const held = new Noise(new Int8Array(0x4000));
    held.table.buffer.transfer();
    return held;
  },
].forEach((make, number) => show("Noise", number, make));
[
  () => new Samples(new Float64Array(0x10000)),
  () => new Samples(new Float64Array(0x5001)),
  () => new Samples(new Float64Array(0)),
  () => new Samples(new Float64Array(new SharedArrayBuffer(0x10000 * Float64Array.BYTES_PER_ELEMENT))),
  () => new Samples(new Float64Array(new ArrayBuffer(0x4000 * Float64Array.BYTES_PER_ELEMENT, { maxByteLength: 0x10000 * Float64Array.BYTES_PER_ELEMENT }))),
  () => {
    const held = new Samples(new Float64Array(0x4000));
    held.table.buffer.transfer();
    return held;
  },
].forEach((make, number) => show("Samples", number, make));
[
  () => new Pixels(new Uint8ClampedArray(0x10000)),
  () => new Pixels(new Uint8ClampedArray(0x5001)),
  () => new Pixels(new Uint8ClampedArray(0)),
  () => new Pixels(new Uint8ClampedArray(new SharedArrayBuffer(0x10000 * Uint8ClampedArray.BYTES_PER_ELEMENT))),
  () => new Pixels(new Uint8ClampedArray(new ArrayBuffer(0x4000 * Uint8ClampedArray.BYTES_PER_ELEMENT, { maxByteLength: 0x10000 * Uint8ClampedArray.BYTES_PER_ELEMENT }))),
  () => {
    const held = new Pixels(new Uint8ClampedArray(0x4000));
    held.table.buffer.transfer();
    return held;
  },
].forEach((make, number) => show("Pixels", number, make));
[
  () => new Words(new Uint16Array(0x10000)),
  () => new Words(new Uint16Array(0x5001)),
  () => new Words(new Uint16Array(0)),
  () => new Words(new Uint16Array(new SharedArrayBuffer(0x10000 * Uint16Array.BYTES_PER_ELEMENT))),
  () => new Words(new Uint16Array(new ArrayBuffer(0x4000 * Uint16Array.BYTES_PER_ELEMENT, { maxByteLength: 0x10000 * Uint16Array.BYTES_PER_ELEMENT }))),
  () => {
    const held = new Words(new Uint16Array(0x4000));
    held.table.buffer.transfer();
    return held;
  },
].forEach((make, number) => show("Words", number, make));
[
  ...[Int8Array, Uint8Array, Int32Array, Uint32Array, Float32Array, Float64Array].map(Kind => () => new Anything(new Kind(0x10000))),
  ...[Object.freeze([1, 2, 3]), undefined, null, 5, "text", new Proxy({}, {}), { buffer: new ArrayBuffer(8) }].map(table => () => new Anything(table)),
].forEach((make, number) => show("Anything", number, make));
