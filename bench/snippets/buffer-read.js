// import { Buffer } from "buffer";
var buf = new Buffer(1024);
// var buf = new Uint8Array(1024);
var view = new DataView(buf.buffer);
var INTERVAL = 9999999;
var time = (name, fn) => {
  console.log(name, fn());
  //   for (let i = 0; i < INTERVAL; i++) fn();

  //   console.time(name.padEnd("DataView.readBigUInt64 (LE)".length));
  //   for (let i = 0; i < INTERVAL; i++) fn();
  //   console.timeEnd(name.padEnd("DataView.readBigUInt64 (LE)".length));
  // };

  // console.log(
  //   `Run ${new Intl.NumberFormat().format(INTERVAL)} times with a warmup:`,
  //   "\n"
};
var array = new Uint8Array(1024);
new Uint8Array(buf.buffer).fill(255);
time("Buffer[]     ", () => buf[0]);
time("Uint8Array[]", () => array[0]);
console.log("");

time("Buffer.getBigInt64BE     ", () => buf.readBigInt64BE(0));
time("DataView.getBigInt64 (BE)", () => view.getBigInt64(0, false).toString(10));
console.log("");

time("Buffer.readBigInt64LE     ", () => buf.readBigInt64LE(0));
time("DataView.readBigInt64 (LE)", () => view.getBigInt64(0, true));
console.log("");
time("Buffer.getBigUInt64BE     ", () => buf.readBigUInt64BE(0));
time("DataView.getBigUInt64 (BE)", () => view.getBigUint64(0, false));
console.log("");
time("Buffer.readBigUInt64LE     ", () => buf.readBigUInt64LE(0));
time("DataView.readBigUInt64 (LE)", () => view.getBigUint64(0, true));
console.log("");
time("Buffer.getDoubleBE     ", () => buf.readDoubleBE(0));
time("DataView.getDouble (BE)", () => view.getFloat64(0, false));
console.log("");
time("Buffer.readDoubleLE     ", () => buf.readDoubleLE(0));
time("DataView.readDouble (LE)", () => view.getFloat64(0, true));
console.log("");
time("Buffer.getFloatBE     ", () => buf.readFloatBE(0));
time("DataView.getFloat (BE)", () => view.getFloat32(0, false));
console.log("");
time("Buffer.readFloatLE     ", () => buf.readFloatLE(0));
time("DataView.readFloat (LE)", () => view.getFloat32(0, true));
console.log("");
time("Buffer.getInt16BE     ", () => buf.readInt16BE(0));
time("DataView.getInt16 (BE)", () => view.getInt16(0, false));
console.log("");
time("Buffer.readInt16LE     ", () => buf.readInt16LE(0));
time("DataView.readInt16 (LE)", () => view.getInt16(0, true));
console.log("");
time("Buffer.getInt32BE     ", () => buf.readInt32BE(0));
time("DataView.getInt32 (BE)", () => view.getInt32(0, false));
console.log("");
time("Buffer.readInt32LE     ", () => buf.readInt32LE(0));
time("DataView.readInt32 (LE)", () => view.getInt32(0, true));
console.log("");
time("Buffer.readInt8     ", () => buf.readInt8(0));
time("DataView.readInt (t8)", () => view.getInt8(0));
console.log("");
time("Buffer.getUInt16BE     ", () => buf.readUInt16BE(0));
time("DataView.getUInt16 (BE)", () => view.getUint16(0, false));
console.log("");
time("Buffer.readUInt16LE     ", () => buf.readUInt16LE(0));
time("DataView.readUInt16 (LE)", () => view.getUint16(0, true));
console.log("");
time("Buffer.getUInt32BE     ", () => buf.readUInt32BE(0));
time("DataView.getUInt32 (BE)", () => view.getUint32(0, false));
console.log("");
time("Buffer.readUInt32LE     ", () => buf.readUInt32LE(0));
time("DataView.getUInt32 (LE)", () => view.getUint32(0, true));
console.log("");
time("Buffer.readUInt8     ", () => buf.readUInt8(0));
time("DataView.getUInt (t8)", () => view.getUint8(0));
console.log("");
