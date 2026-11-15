const { Readable, Writable, finished, isDestroyed, isErrored, isReadable, isDisturbed } = require("node:stream");
const { watch, turns } = require("./watch.cjs");
const sink = () => new Writable({ write(chunk, encoding, done) { done(); } });
module.exports = [
  [
    ["bytes pushed to a listener", async (log, what, mark) => { const r = new Readable({ read() {} }); r.on("data", () => {}); await turns(2); watch(r, log, what); r.push("ab"); mark("second"); r.push("cd"); }],
    ["objects pushed to a listener", async (log, what, mark) => { const r = new Readable({ objectMode: true, read() {} }); r.on("data", () => {}); await turns(2); watch(r, log, what); r.push({}); mark("second"); r.push({}); }],
    ["pushed while paused, then read", async (log, what, mark) => { const r = new Readable({ read() {} }); watch(r, log, what); r.push("ab"); mark("read"); r.read(); mark("read 1"); r.push("cd"); r.read(1); }],
    ["a listener of readable", async (log, what, mark) => { const r = new Readable({ read() {} }); watch(r, log, what); r.on("readable", () => { mark("heard"); r.read(); }); mark("push"); r.push("ab"); await turns(2); mark("end"); r.push(null); }],
    ["piped", async (log, what, mark) => { const r = new Readable({ read() {} }); watch(r, log, what); r.pipe(sink()); mark("push"); r.push("ab"); await turns(2); mark("end"); r.push(null); }],
    ["for await", async (log, what, mark) => { const r = new Readable({ read() {} }); r.push("ab"); r.push(null); watch(r, log, what); for await (const chunk of r) mark("chunk"); }],
    ["for await, left early", async (log, what, mark) => { const r = new Readable({ objectMode: true, read() {} }); r.push(1); r.push(2); watch(r, log, what); for await (const chunk of r) { mark("chunk"); break; } }],
    ["from a list", async (log, what, mark) => { const r = Readable.from([1, 2]); watch(r, log, what); for await (const chunk of r) mark("chunk"); }],
    ["from a list, to a listener", async (log, what, mark) => { const r = Readable.from(["a", "b"]); watch(r, log, what); r.on("data", () => mark("data")); r.on("end", () => mark("end")); }],
    ["destroyed", async (log, what, mark) => { const r = new Readable({ read() {} }); watch(r, log, what); r.destroy(); mark("again"); r.destroy(); }],
    ["destroyed with an error", async (log, what, mark) => { const r = new Readable({ read() {} }); r.on("error", () => {}); watch(r, log, what); r.destroy(new Error("made up")); }],
    ["finished", async (log, what, mark) => { const r = new Readable({ read() {} }); watch(r, log, what); finished(r, () => mark("finished")); mark("resume"); r.resume(); r.push(null); }],
    ["what it says of itself", async (log, what, mark) => { const r = new Readable({ read() {} }); watch(r, log, what); for (const name of ["destroyed", "readableEnded", "errored", "closed", "readableFlowing", "readableLength", "readableObjectMode", "readableHighWaterMark", "readable", "readableAborted", "readableDidRead", "readableEncoding", "readableBuffer"]) { mark(name); r[name]; } }],
    ["paused and resumed", async (log, what, mark) => { const r = new Readable({ read() {} }); watch(r, log, what); r.pause(); mark("asked"); r.isPaused(); mark("resume"); r.resume(); await turns(2); mark("pause"); r.pause(); }],
    ["put back, and an encoding", async (log, what, mark) => { const r = new Readable({ read() {} }); watch(r, log, what); r.unshift("ab"); mark("encoding"); r.setEncoding("utf8"); mark("push"); r.push("cd"); mark("read"); r.read(); }],
    ["listeners come and go", async (log, what, mark) => { const r = new Readable({ read() {} }); watch(r, log, what); const f = () => {}; for (const name of ["data", "readable", "end", "made", "made-up!", "close", "error", "pause", "resume"]) { mark(name); r.on(name, f); mark("off"); r.removeListener(name, f); } mark("all"); r.removeAllListeners(); }],
    ["the questions of node:stream", async (log, what, mark) => { const r = new Readable({ read() {} }); watch(r, log, what); isDestroyed(r); mark("errored"); isErrored(r); mark("readable"); isReadable(r); mark("disturbed"); isDisturbed(r); }],
    ["unpiped", async (log, what, mark) => { const r = new Readable({ read() {} }); const a = sink(), b = sink(); r.pipe(a); r.pipe(b); watch(r, log, what); r.unpipe(a); mark("push"); r.push("ab"); await turns(2); mark("all"); r.unpipe(); }],
    ["ended with nothing", async (log, what, mark) => { const r = new Readable({ read() {} }); r.on("end", () => mark("end")); watch(r, log, what); r.resume(); r.push(null); }],
  ],
  ["r", "e", "re", "a", "p", "ap"],
];
