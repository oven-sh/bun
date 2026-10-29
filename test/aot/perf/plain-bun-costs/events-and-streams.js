const { EventEmitter } = require("node:events");
const { Readable, Transform, Writable, pipeline } = require("node:stream");
let sum = 0;
const emitter = new EventEmitter();
emitter.on("one", a => { sum += a; });
for (let i = 0; i < 3; i++) emitter.on("three", (a, b) => { sum += a + b; });
for (let i = 0; i < 300000; i++) { emitter.emit("one", 1); emitter.emit("three", 1, 2); }
for (let i = 0; i < 60000; i++) { const listener = () => {}; emitter.on("x", listener); emitter.off("x", listener); emitter.once("y", () => { sum++; }); emitter.emit("y"); }
let rounds = 0;
function round() {
  let next = 0;
  pipeline(
    new Readable({ read() { this.push(next < 300 ? Buffer.alloc(64, next++) : null); } }),
    new Transform({ transform(chunk, encoding, done) { done(null, chunk.subarray(0, 32)); } }),
    new Writable({ write(chunk, encoding, done) { sum += chunk.length; done(); } }),
    error => { if (error) throw error; if (++rounds < 60) round(); else console.log(sum); },
  );
}
round();
