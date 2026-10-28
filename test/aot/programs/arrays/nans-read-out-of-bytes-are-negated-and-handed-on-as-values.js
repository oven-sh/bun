// Reads NaNs out of the bytes of float views and of DataViews, changes their sign, hands them on as arguments, fields and list elements, and prints the bytes of each without its sign.
const from64 = new Float64Array(
  new BigUint64Array([0xfff8060504030201n, 0x7ff0000000000007n, 0x7ff8000000000000n, 0xfff8000000000000n]).buffer,
);
const from32 = new Float32Array(new Uint32Array([0xffc12345, 0x7f800007, 0x7fc00000, 0xffc00000]).buffer);
const data64 = new DataView(from64.buffer);
const data32 = new DataView(from32.buffer);
const hex = value => {
  const bytes = new Uint8Array(new Float64Array([value]).buffer);
  bytes[7] &= 0x7f;
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
};
const holder = { value: 0.5 };
function throughField(value) {
  holder.value = value;
  return holder.value;
}

for (let at = 0; at < 4; at++) {
  console.log(
    "Float64Array",
    at,
    hex(from64[at]),
    hex(-from64[at]),
    hex(Math.abs(from64[at])),
    hex(-Math.abs(from64[at])),
  );
  console.log(
    "Float32Array",
    at,
    hex(from32[at]),
    hex(-from32[at]),
    hex(Math.abs(from32[at])),
    hex(-Math.abs(from32[at])),
  );
  console.log("getFloat64", at, hex(-data64.getFloat64(at * 8, true)), hex(-Math.abs(data64.getFloat64(at * 8, true))));
  console.log("getFloat32", at, hex(-data32.getFloat32(at * 4, true)), hex(-Math.abs(data32.getFloat32(at * 4, true))));
  console.log("twice", at, hex(-(-from64[at])), hex(-(-from64[at] * 2)), hex(-from64[at] * -from32[at]));
  console.log(
    "other ways",
    at,
    hex(0 - from64[at]),
    hex(from64[at] * -1),
    hex(from64[at] / -1),
    hex(-Math.fround(from64[at])),
  );
  console.log(
    "by a test",
    at,
    hex(from64[at] < 0 ? from64[at] : -from64[at]),
    hex(Math.min(-from32[at], 1)),
    hex(-Math.sqrt(from64[at])),
  );
  console.log(
    "field",
    at,
    hex(throughField(-from64[at])),
    hex(throughField(-from32[at])),
    hex(throughField(-data64.getFloat64(at * 8, true))),
  );
  const list = [-from64[at], -from32[at], -Math.abs(from64[at])];
  console.log(
    "list",
    at,
    list.map(hex).join(" "),
    Object.is(list[0], NaN),
    new Set(list).size,
    list.includes(NaN),
    String(list[1]),
  );
}
