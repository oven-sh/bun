const { Readable, Writable, Duplex, Transform, PassThrough, finished, pipeline, isDestroyed, isErrored, isWritable } = require("node:stream");
const { watch, turns } = require("./watch.cjs");
const make = () => new Writable({ write(chunk, encoding, done) { done(); } });
const later = () => new Writable({ write(chunk, encoding, done) { setImmediate(done); } });
module.exports = [
  [
    ["written", async (log, what, mark) => { const w = make(); watch(w, log, what); w.write("ab"); mark("second"); w.write("cd", () => mark("done")); }],
    ["written, done later", async (log, what, mark) => { const w = later(); watch(w, log, what); w.write("ab"); mark("second"); w.write("cd"); }],
    ["ended", async (log, what, mark) => { const w = make(); watch(w, log, what); w.end("ab", () => mark("ended")); }],
    ["corked", async (log, what, mark) => { const w = make(); watch(w, log, what); w.cork(); w.write("ab"); w.write("cd"); mark("uncork"); w.uncork(); }],
    ["destroyed", async (log, what, mark) => { const w = make(); watch(w, log, what); w.destroy(); }],
    ["finished", async (log, what, mark) => { const w = make(); watch(w, log, what); finished(w, () => mark("finished")); mark("end"); w.end(); }],
    ["what it says of itself", async (log, what, mark) => { const w = make(); watch(w, log, what); for (const name of ["destroyed", "writable", "writableFinished", "writableObjectMode", "writableBuffer", "writableEnded", "writableNeedDrain", "writableHighWaterMark", "writableCorked", "writableLength", "errored", "writableAborted", "closed"]) { mark(name); w[name]; } }],
    ["the questions of node:stream", async (log, what, mark) => { const w = make(); watch(w, log, what); isDestroyed(w); mark("errored"); isErrored(w); mark("writable"); isWritable(w); }],
    ["a transform", async (log, what, mark) => { const t = new Transform({ transform(chunk, encoding, done) { done(null, chunk); } }); t.on("data", () => mark("data")); await turns(2); watch(t, log, what); t.write("ab"); await turns(2); mark("end"); t.end(); }],
    ["a transform that pushes", async (log, what, mark) => { const t = new Transform({ objectMode: true, transform(chunk, encoding, done) { this.push(chunk); this.push(chunk); done(); } }); t.on("data", () => mark("data")); await turns(2); watch(t, log, what); t.write({}); }],
    ["through a pipeline", async (log, what, mark) => { const p = new PassThrough(); watch(p, log, what); pipeline(Readable.from(["a"]), p, make(), () => mark("done")); }],
    ["a duplex", async (log, what, mark) => { const d = new Duplex({ read() {}, write(chunk, encoding, done) { done(); } }); watch(d, log, what); d.write("ab"); mark("push"); d.push("cd"); mark("read"); d.read(); mark("destroyed?"); isDestroyed(d); d.destroyed; mark("end"); d.end(); d.push(null); d.resume(); }],
    ["finished, both sides", async (log, what, mark) => { const d = new PassThrough(); watch(d, log, what); finished(d, () => mark("finished")); mark("end"); d.end(); d.resume(); }],
  ],
  ["w", "e", "rwe", "a", "p", "ap"],
];
