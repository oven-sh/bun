// Writes NaNs made in many ways into Float16Array, Float32Array, Float64Array and DataView over every kind of buffer, and prints the bytes.
const hex = (buffer, from, size) =>
  Array.from(new Uint8Array(buffer, from, size), byte => byte.toString(16).padStart(2, "0")).join("");

const zero = [0].map(Number)[0];
const infinity = [Infinity].map(Number)[0];
const doubles = new Float64Array(
  new BigUint64Array([
    0x7ff8000000001234n,
    0xfff8000000005678n,
    0x7ff0000000000001n,
    0xffffffffffffffffn,
    0xfff8000000000000n,
  ]).buffer,
);
const floats = new Float32Array(new Uint32Array([0x7fc01234, 0xffc05678, 0x7f800001, 0xffffffff, 0xffc00000]).buffer);
const halves = new Float16Array(new Uint16Array([0x7e12, 0xfe56, 0x7c01, 0xffff, 0xfe00]).buffer);
const bytesOfDoubles = new DataView(doubles.buffer);

const computed = {
  "0 / 0": () => zero / zero,
  "-(0 / 0)": () => -(zero / zero),
  "Infinity - Infinity": () => infinity - infinity,
  "Infinity * 0": () => infinity * zero,
  "Infinity / Infinity": () => infinity / infinity,
  "0 % 0": () => zero % zero,
  "1.5 % 0": () => (zero + 1.5) % zero,
  "Math.abs(Math.sqrt(-1))": () => Math.abs(Math.sqrt(zero - 1)),
  "Math.abs(0 / 0)": () => Math.abs(zero / zero),
  "Math.fround(0 / 0)": () => Math.fround(zero / zero),
  "Math.f16round(0 / 0)": () => Math.f16round(zero / zero),
  "Math.max(0 / 0, 1)": () => Math.max(zero / zero, 1),
  "Math.min(1, 0 / 0)": () => Math.min(1, zero / zero),
  "Math.floor(0 / 0)": () => Math.floor(zero / zero),
  "Math.trunc(0 / 0)": () => Math.trunc(zero / zero),
  "Math.round(0 / 0)": () => Math.round(zero / zero),
  "Math.sign(0 / 0)": () => Math.sign(zero / zero),
  "Math.hypot(0 / 0, 1)": () => Math.hypot(zero / zero, 1),
  "(0 / 0) ** 1": () => (zero / zero) ** 1,
  "(0 / 0) ** 2": () => (zero / zero) ** 2,
  "(-8) ** (1 / 3)": () => (zero - 8) ** (1 / 3),
  "0 / 0 + 1": () => zero / zero + 1,
  "1 - 0 / 0": () => 1 - zero / zero,
  "+(0 / 0)": () => +(zero / zero),
  "Number(0 / 0)": () => Number(zero / zero),
  "parseFloat": () => parseFloat("x"),
  "parseInt": () => parseInt("x"),
  "Number of text": () => Number("x"),
  "+undefined": () => +[undefined][zero],
  "undefined + 1": () => [undefined][zero] + 1,
  "NaN": () => NaN,
  "-NaN": () => -NaN,
  "Number.NaN": () => Number.NaN,
  "time of no date": () => new Date("x").getTime(),
  "code of no character": () => "".charCodeAt(zero),
  "out of an object": () => ({ held: zero / zero }).held,
  "out of an array": () => [zero / zero, 1.5][zero],
  "out of a pushed array": () => {
    const list = [1.5];
    list.push(zero / zero);
    return list[1];
  },
  "out of a map": () => new Map([[1, zero / zero]]).get(1),
  "caught": () => {
    try {
      throw zero / zero;
    } catch (thrown) {
      return thrown;
    }
  },
  "yielded": () =>
    (function* () {
      yield zero / zero;
    })().next().value,
};

const read = {};
for (let i = 0; i < 5; i++) {
  read["double " + i] = () => doubles[i];
  read["float " + i] = () => floats[i];
  read["half " + i] = () => halves[i];
  read["getFloat64 " + i] = () => bytesOfDoubles.getFloat64(i * 8, true);
  read["getFloat32 " + i] = () => bytesOfDoubles.getFloat32(i * 8 + 4, true);
  read["getFloat16 " + i] = () => bytesOfDoubles.getFloat16(i * 8 + 6, true);
  read["getFloat64 of the other order " + i] = () => bytesOfDoubles.getFloat64(i * 8);
  read["-double " + i] = () => -doubles[i];
  read["double + 1 " + i] = () => doubles[i] + 1;
  read["at " + i] = () => doubles.at(i);
  read["iterated " + i] = () => [...floats][i];
}

const buffers = {
  "fixed": () => new ArrayBuffer(32),
  "resizable": () => new ArrayBuffer(32, { maxByteLength: 64 }),
  "resized": () => {
    const buffer = new ArrayBuffer(8, { maxByteLength: 64 });
    buffer.resize(32);
    return buffer;
  },
  "shared": () => new SharedArrayBuffer(32),
  "growable": () => new SharedArrayBuffer(32, { maxByteLength: 64 }),
  "grown": () => {
    const buffer = new SharedArrayBuffer(8, { maxByteLength: 64 });
    buffer.grow(32);
    return buffer;
  },
};

const kinds = [Float16Array, Float32Array, Float64Array];

const views = {
  "whole": (Kind, buffer) => new Kind(buffer),
  "part": (Kind, buffer) => new Kind(buffer, 8, 2),
  "tail": (Kind, buffer) => new Kind(buffer, 8),
};

const writers = {
  "index": (view, value) => {
    view[1] = value;
  },
  "loop": (view, value) => {
    for (let i = 0; i < 2; i++) view[i] = value;
  },
  "set": (view, value) => {
    view.set([value], 1);
  },
  "set of a view": (view, value) => {
    const from = new view.constructor(1);
    from[0] = value;
    view.set(from, 1);
  },
  "set of a wider view": (view, value) => {
    const from = new Float64Array(1);
    from[0] = value;
    view.set(from, 1);
  },
  "fill": (view, value) => {
    view.fill(value, 1, 2);
  },
  "with": (view, value) => {
    view.set(view.with(1, value));
  },
  "map": (view, value) => {
    view.set(view.map(() => value));
  },
  "from": (view, value) => {
    view.set(view.constructor.from([value]), 1);
  },
  "of": (view, value) => {
    view.set(view.constructor.of(value), 1);
  },
  "Reflect.set": (view, value) => {
    Reflect.set(view, 1, value);
  },
  "defineProperty": (view, value) => {
    Object.defineProperty(view, 1, { value });
  },
  "a key that is text": (view, value) => {
    view["1"] = value;
  },
  "copyWithin": (view, value) => {
    view[0] = value;
    view.copyWithin(1, 0, 1);
  },
  "DataView": (view, value) => {
    new DataView(view.buffer)["set" + view.constructor.name.slice(0, -5)](
      view.byteOffset + view.BYTES_PER_ELEMENT,
      value,
      true,
    );
  },
  "DataView of the other order": (view, value) => {
    new DataView(view.buffer)["set" + view.constructor.name.slice(0, -5)](
      view.byteOffset + view.BYTES_PER_ELEMENT,
      value,
    );
  },
};

function print(made, make, held, Kind, shape) {
  const row = [];
  const value = make();
  for (const [way, write] of Object.entries(writers)) {
    const buffer = buffers[held]();
    const view = views[shape](Kind, buffer);
    write(view, value);
    row.push(way + " " + hex(buffer, view.byteOffset + Kind.BYTES_PER_ELEMENT, Kind.BYTES_PER_ELEMENT));
  }
  console.log(made, "|", held, "|", Kind.name, "|", shape, "|", row.join(", "));
}

for (const [made, make] of Object.entries(computed)) {
  for (const held of Object.keys(buffers)) {
    for (const Kind of kinds) {
      for (const shape of Object.keys(views)) print(made, make, held, Kind, shape);
    }
  }
}

for (const [made, make] of Object.entries(read)) {
  print(made, make, "fixed", Float64Array, "whole");
  print(made, make, "resizable", Float32Array, "tail");
  print(made, make, "growable", Float16Array, "part");
}

for (const Kind of kinds) {
  const buffer = new ArrayBuffer(32, { maxByteLength: 64 });
  const part = new Kind(buffer, 16, 2);
  const tail = new Kind(buffer, 16);
  buffer.resize(8);
  part[0] = zero / zero;
  tail[0] = zero / zero;
  let refusal;
  try {
    tail.fill(zero / zero);
  } catch (error) {
    refusal = error.constructor.name;
  }
  console.log(
    Kind.name,
    "outside a buffer that shrank",
    part.length,
    tail.length,
    Reflect.set(part, 0, zero / zero),
    Reflect.set(tail, 0, zero / zero),
    refusal,
  );
  buffer.resize(32);
  console.log(Kind.name, "when it has grown again", hex(buffer, 0, 32));
  tail[1] = zero / zero;
  part[0] = -(zero / zero);
  console.log(Kind.name, "written then", hex(buffer, 0, 32));
  try {
    Atomics.store(new Kind(new SharedArrayBuffer(8, { maxByteLength: 16 })), 0, zero / zero);
  } catch (error) {
    refusal = error.constructor.name;
  }
  console.log(Kind.name, "Atomics.store", refusal);
}
