// A package marked --external is interpreted. It requires a built-in module that the program does not use: that module runs from its text, and takes what it needs off the internal modules
// that were compiled for the program. What no compiled code reads there is there for it all the same: node:zlib takes checkRangesOrGetDefault off the validators that node:events brought in.
// Flags: --external outside-package
const { EventEmitter } = require("node:events");
const outside = require("outside-package");
const emitter = new EventEmitter();
emitter.on("unpacked", text => console.log(text));
emitter.emit("unpacked", outside.packAndUnpack("a text that is packed and unpacked"));
