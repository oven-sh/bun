// ptr, read.*, toBuffer and toArrayBuffer only type-check their arguments, so they must not pull util.inspect into the executable.
// STATISTIC: ImageFunctionsEmitted <= 40
import { ptr, read, toArrayBuffer, toBuffer } from "bun:ffi";

const bytes = new Uint8Array([104, 101, 108, 108, 111, 0, 0, 0]);
const address = ptr(bytes);
console.log(
  typeof address,
  String(read.u8(address, 1)),
  String(read.u16(address) & 0xff),
  String(read.i8(address, 4)),
  typeof read.u64(address),
  typeof read.f64(address),
  String(toBuffer(address, 0, 5).length),
  String(toArrayBuffer(address, 1, 4).byteLength),
  String(ptr(bytes, 2) - address),
);
const refused = ptr({});
console.log(String(Error.isError(refused)), refused.name, refused.code);
