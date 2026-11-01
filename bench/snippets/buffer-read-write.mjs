// Buffer.prototype.read* / write* — the fixed-width accessors that JSC JIT-compiles into
// bounds-checked loads/stores (see JSBuffer.cpp / JavaScriptCore BufferAccessorRegistry).
//
// Three shapes:
//   - a tight loop over one buffer (constant offset): mostly measures call/loop overhead
//   - a loop over increasing offsets on one buffer: the load/store + bounds check per iteration
//   - one access on each of many distinct buffers: previously paid a hidden DataView allocation
//     plus a structure transition per buffer
import { bench, group, run } from "../runner.mjs";

const size = 4096;
const buf = Buffer.alloc(size);
for (let i = 0; i < size; i++) buf[i] = (i * 37 + 11) & 0xff;

const many = Array.from({ length: 1024 }, () => Buffer.alloc(64));

group("constant offset (10 accesses per iteration)", () => {
  bench("readInt32LE(0)", () => {
    let s = 0;
    for (let i = 0; i < 10; i++) s += buf.readInt32LE(0);
    return s;
  });
  bench("writeInt32LE(v, 0)", () => {
    for (let i = 0; i < 10; i++) buf.writeInt32LE(i, 0);
  });
});

group("varying offset over one buffer", () => {
  bench("readInt8", () => {
    let s = 0;
    for (let i = 0; i < size; i++) s += buf.readInt8(i);
    return s;
  });
  bench("readUInt8", () => {
    let s = 0;
    for (let i = 0; i < size; i++) s += buf.readUInt8(i);
    return s;
  });
  bench("readInt16BE", () => {
    let s = 0;
    for (let i = 0; i < size; i += 2) s += buf.readInt16BE(i);
    return s;
  });
  bench("readInt32LE", () => {
    let s = 0;
    for (let i = 0; i < size; i += 4) s += buf.readInt32LE(i);
    return s;
  });
  bench("readUInt32BE", () => {
    let s = 0;
    for (let i = 0; i < size; i += 4) s += buf.readUInt32BE(i);
    return s;
  });
  bench("readFloatLE", () => {
    let s = 0;
    for (let i = 0; i < size; i += 4) s += buf.readFloatLE(i);
    return s;
  });
  bench("readDoubleLE", () => {
    let s = 0;
    for (let i = 0; i < size; i += 8) s += buf.readDoubleLE(i);
    return s;
  });
  bench("readBigInt64LE", () => {
    let s = 0n;
    for (let i = 0; i < size; i += 8) s += buf.readBigInt64LE(i);
    return s;
  });
  bench("writeUInt8", () => {
    for (let i = 0; i < size; i++) buf.writeUInt8(i & 0xff, i);
  });
  bench("writeInt16BE", () => {
    for (let i = 0; i < size; i += 2) buf.writeInt16BE(i, i);
  });
  bench("writeInt32LE", () => {
    for (let i = 0; i < size; i += 4) buf.writeInt32LE(i, i);
  });
  bench("writeUInt32BE", () => {
    for (let i = 0; i < size; i += 4) buf.writeUInt32BE(i, i);
  });
  bench("writeFloatLE", () => {
    for (let i = 0; i < size; i += 4) buf.writeFloatLE(i + 0.5, i);
  });
  bench("writeDoubleLE", () => {
    for (let i = 0; i < size; i += 8) buf.writeDoubleLE(i + 0.5, i);
  });
});

group("one access on each of 1024 buffers", () => {
  bench("readInt32LE", () => {
    let s = 0;
    for (let i = 0; i < many.length; i++) s += many[i].readInt32LE(0);
    return s;
  });
  bench("writeInt32LE", () => {
    for (let i = 0; i < many.length; i++) many[i].writeInt32LE(i, 0);
  });
  bench("readDoubleLE", () => {
    let s = 0;
    for (let i = 0; i < many.length; i++) s += many[i].readDoubleLE(0);
    return s;
  });
});

await run();
