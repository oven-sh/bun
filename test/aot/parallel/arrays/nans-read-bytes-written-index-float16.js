// Reads NaNs out of the bytes of float views and of DataViews, writes them by index into a Float16Array, and prints its bytes on x64. A processor that converts to a Float16 itself keeps more of a NaN once the code is warm.
const from64 = new Float64Array(
  new BigUint64Array([0xfff8060504030201n, 0x7ff0000000000007n, 0x7ff8000000000000n, 0xfff8000000000000n]).buffer,
);
const from32 = new Float32Array(new Uint32Array([0xffc12345, 0x7f800007, 0x7fc00000, 0xffc00000]).buffer);
const from16 = new Float16Array(new Uint16Array([0xfe12, 0x7c07, 0x7e00, 0xfe00]).buffer);
const data64 = new DataView(from64.buffer);
const data32 = new DataView(from32.buffer);
const data16 = new DataView(from16.buffer);
const to16 = new Float16Array(4);
const bytes = new Uint8Array(to16.buffer);
function report(name) {
  console.log(
    name,
    process.arch === "x64" ? Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("") : "",
  );
  to16.fill(0);
}

to16[0] = from64[0];
to16[1] = from64[1];
to16[2] = from64[2];
to16[3] = from64[3];
report("Float64Array");
to16[0] = from32[0];
to16[1] = from32[1];
to16[2] = from32[2];
to16[3] = from32[3];
report("Float32Array");
to16[0] = from16[0];
to16[1] = from16[1];
to16[2] = from16[2];
to16[3] = from16[3];
report("Float16Array");
to16[0] = data64.getFloat64(0, true);
to16[1] = data64.getFloat64(8, true);
to16[2] = data64.getFloat64(16, true);
to16[3] = data64.getFloat64(24, true);
report("getFloat64");
to16[0] = data32.getFloat32(0, true);
to16[1] = data32.getFloat32(4, true);
to16[2] = data32.getFloat32(8, true);
to16[3] = data32.getFloat32(12, true);
report("getFloat32");
to16[0] = data16.getFloat16(0, true);
to16[1] = data16.getFloat16(2, true);
to16[2] = data16.getFloat16(4, true);
to16[3] = data16.getFloat16(6, true);
report("getFloat16");

for (let at = 0; at < 4; at++) to16[at] = from64[at];
report("Float64Array in a loop");
for (let at = 0; at < 4; at++) to16[at] = from32[at];
report("Float32Array in a loop");
for (let at = 0; at < 4; at++) to16[at] = data64.getFloat64(at * 8, true);
report("getFloat64 in a loop");
for (let at = 0; at < 4; at++) to16[at] = data32.getFloat32(at * 4, true);
report("getFloat32 in a loop");

for (let at = 0; at < 4; at++) to16[at] = 0 - data64.getFloat64(at * 8, true);
report("0 - x");
for (let at = 0; at < 4; at++) to16[at] = data64.getFloat64(at * 8, true) * -1;
report("x * -1");
for (let at = 0; at < 4; at++) to16[at] = data32.getFloat32(at * 4, true) / -1;
report("x / -1");
for (let at = 0; at < 4; at++) to16[at] = data32.getFloat32(at * 4, true) + 0;
report("x + 0");
for (let at = 0; at < 4; at++) to16[at] = -(-data64.getFloat64(at * 8, true));
report("-(-x)");
for (let at = 0; at < 4; at++) to16[at] = Math.fround(data64.getFloat64(at * 8, true));
report("Math.fround(x)");
for (let at = 0; at < 4; at++) to16[at] = Math.abs(from64[at]);
report("Math.abs(x)");
for (let at = 0; at < 4; at++) to16[at] = from64[at] < 0 ? -from64[at] : from64[at];
report("x < 0 ? -x : x");

const zero = [0].map(Number)[0];
to16[0] = zero / zero;
to16[1] = -(zero / zero);
to16[2] = NaN;
to16[3] = -NaN;
report("computed");
