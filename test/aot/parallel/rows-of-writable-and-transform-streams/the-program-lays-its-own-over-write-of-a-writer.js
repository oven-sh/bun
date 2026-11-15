// The prototype is not locked: what the program lays there is called.
const own = [];
const written = WritableStreamDefaultWriter.prototype.write;
WritableStreamDefaultWriter.prototype.write = function (chunk) {
  own.push(`own ${chunk}`);
  return written.call(this, `${chunk}!`);
};
const seen = [];
const writer = new WritableStream({ write: chunk => void seen.push(chunk) }).getWriter();
await writer.write("made up");
await writer.close();
console.log(`${own.join()} ${seen.join()}`);
