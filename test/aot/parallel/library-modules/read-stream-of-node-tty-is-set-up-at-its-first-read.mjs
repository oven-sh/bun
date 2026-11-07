// tty.ReadStream stands below fs.ReadStream, whose module loads node:stream. It is put there when it is first read, and is a plain member from then on.
import fs from "node:fs";
import tty from "node:tty";
import * as names from "node:tty";
const describe = () => {
  const { get, set, value, ...rest } = Object.getOwnPropertyDescriptor(tty, "ReadStream");
  return [typeof get, typeof set, typeof value, JSON.stringify(rest)].join(" ");
};
console.log(Object.keys(tty).join(), "|", Object.keys(names).sort().join());
console.log(describe());
const { ReadStream, WriteStream } = tty;
console.log(describe(), Object.keys(tty).join());
console.log(
  tty.ReadStream === ReadStream,
  names.ReadStream === ReadStream,
  names.WriteStream === WriteStream,
  names.isatty === tty.isatty,
);
console.log(ReadStream.name, ReadStream.length, WriteStream.name, WriteStream.length);
console.log(
  Object.getPrototypeOf(ReadStream) === fs.ReadStream,
  Object.getPrototypeOf(ReadStream.prototype) === fs.ReadStream.prototype,
);
console.log(
  WriteStream.prototype === fs.WriteStream.prototype,
  typeof ReadStream.prototype.setRawMode,
  typeof WriteStream.prototype.getColorDepth,
);
tty.ReadStream = 5;
console.log(tty.ReadStream, describe());
