const Writable = require("_stream_writable");
delete Writable.prototype.cork;
Writable.prototype.end = function () {
  return "ended";
};
const { Duplex, PassThrough, finished } = require("node:stream");
console.log(Object.keys(Duplex.prototype).join(), Object.getOwnPropertyNames(Duplex.prototype).join());
for (const name of ["write", "cork", "end", "extra", "_writev"])
  console.log(name, typeof Duplex.prototype[name], Duplex.prototype[name] === Writable.prototype[name], Object.hasOwn(Duplex.prototype, name));
const stream = new PassThrough();
finished(stream, error => console.log("finished", error?.code));
console.log(String(stream.write("x")), typeof stream.end());
stream.resume();
