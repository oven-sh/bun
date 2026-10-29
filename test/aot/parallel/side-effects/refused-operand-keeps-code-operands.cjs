// A built-in that refuses an operand runs no code of the operands behind it: a negative offset into a DataView, a negative width for BigInt.asIntN, a buffer of a fixed length, a receiver that is no module.
const Module = require("node:module");

const ran = [];

function nameOfError(call) {
  try {
    call();
  } catch (error) {
    return error.name;
  }
  return "none";
}

function report(name, call) {
  const before = ran.length;
  console.log(name, nameOfError(call), ran.length === before ? "ran nothing" : `ran ${ran.slice(before)}`);
}

function storeNumbers(offset) {
  const view = new DataView(new ArrayBuffer(16));
  report("setInt8", () => view.setInt8(offset, { valueOf: () => ran.push("setInt8") }));
  report("setUint8", () => view.setUint8(offset, { valueOf: () => ran.push("setUint8") }));
  report("setInt16", () => view.setInt16(offset, { valueOf: () => ran.push("setInt16") }));
  report("setUint16", () => view.setUint16(offset, { valueOf: () => ran.push("setUint16") }, true));
  report("setInt32", () => view.setInt32(offset, { valueOf: () => ran.push("setInt32") }));
  report("setUint32", () => view.setUint32(offset, { valueOf: () => ran.push("setUint32") }, true));
  report("setFloat16", () => view.setFloat16(offset, { valueOf: () => ran.push("setFloat16") }));
  report("setFloat32", () => view.setFloat32(offset, { valueOf: () => ran.push("setFloat32") }));
  report("setFloat64", () => view.setFloat64(offset, { valueOf: () => ran.push("setFloat64") }, true));
}

function storeBigInts(offset) {
  const view = new DataView(new ArrayBuffer(16));
  report("setBigInt64", () => view.setBigInt64(offset, { valueOf: () => BigInt(ran.push("setBigInt64")) }));
  report("setBigUint64", () => view.setBigUint64(offset, { valueOf: () => BigInt(ran.push("setBigUint64")) }));
  report("asIntN", () => BigInt.asIntN(offset, { valueOf: () => BigInt(ran.push("asIntN")) }));
  report("asUintN", () => BigInt.asUintN(offset, { valueOf: () => BigInt(ran.push("asUintN")) }));
}

function changeLengths() {
  const fixed = new ArrayBuffer(8);
  const resizable = new ArrayBuffer(8, { maxByteLength: 16 });
  const shared = new SharedArrayBuffer(8);
  const growable = new SharedArrayBuffer(8, { maxByteLength: 16 });
  report("resize, fixed", () => fixed.resize({ valueOf: () => ran.push("resize, fixed") }));
  report("resize, resizable", () => resizable.resize({ valueOf: () => ran.push("resize, resizable") }));
  report("grow, fixed", () => shared.grow({ valueOf: () => ran.push("grow, fixed") + 8 }));
  report("grow, growable", () => growable.grow({ valueOf: () => ran.push("grow, growable") + 8 }));
}

function askTheLoader() {
  report("_load", () => Module._load({ toString: () => `node:path${ran.push("_load")}` }));
  report("_compile", () => Module.prototype._compile.call({}, { toString: () => `${ran.push("_compile")}` }, "a.js"));
}

storeNumbers(-1);
storeNumbers(0);
storeNumbers(16);
storeBigInts(-1);
storeBigInts(0);
changeLengths();
askTheLoader();
