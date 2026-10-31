// `new Readable({ read() {} })`: the constructor reads `options.read` of every caller's literal. A stub makes the function there, not the run time.
// COUNT: operation:operationAOTMaterializeDeferredClosure <= 100
const { Readable } = require("node:stream");
let length = 0;
let last;
for (let i = 0; i < 3000; i++) {
  last = new Readable({
    read() {
      this.push(null);
    },
  });
  length += last.readableLength;
}
console.log(length, typeof last._read, last._read.name, last._read.length);
last.on("end", () => console.log("ended"));
last.resume();
