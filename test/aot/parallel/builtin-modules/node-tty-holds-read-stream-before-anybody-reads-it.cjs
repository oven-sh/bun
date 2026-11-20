// ReadStream of node:tty is a value from the start, as in plain Bun: the module loads the streams of files while it loads.
const tty = require("node:tty");
const kindOf = descriptor => ("value" in descriptor ? "value" : "accessor");
const flagsOf = ({ enumerable, configurable }) => [enumerable, configurable].map(Number).join("");
const before = Object.getOwnPropertyDescriptor(tty, "ReadStream");
console.log("before the first read:", kindOf(before), flagsOf(before));
const { ReadStream } = tty;
const behind = Object.getOwnPropertyDescriptor(tty, "ReadStream");
console.log("behind it:", kindOf(behind), flagsOf(behind), behind.writable, behind.value === ReadStream);
console.log(ReadStream.name, ReadStream.length, Object.getPrototypeOf(ReadStream) === require("node:fs").ReadStream);
console.log(Object.keys(tty).join());
