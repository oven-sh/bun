const { Readable, Writable, Duplex, Transform, PassThrough } = require("node:stream");
let sum = 0;
for (let i = 0; i < 40000; i++) sum += new Readable().readableLength;
for (let i = 0; i < 40000; i++) sum += new Writable().writableLength;
for (let i = 0; i < 40000; i++) sum += new Duplex().writableLength;
for (let i = 0; i < 40000; i++) sum += new Transform().writableLength;
for (let i = 0; i < 40000; i++) sum += new PassThrough({ highWaterMark: 16 }).writableHighWaterMark;
for (let i = 0; i < 40000; i++) sum += new Readable({ read() {}, objectMode: true }).readableHighWaterMark;
console.log(sum);
