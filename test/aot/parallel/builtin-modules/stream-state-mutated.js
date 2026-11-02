const { Readable, Writable, Duplex } = require("stream");
// What programs do to `stream._readableState` and `stream._writableState`. PART 1: idioms of packages (ws, undici, got, readable-stream's helpers, split2, duplexify, stream-shift, end-of-stream). PART 2: what a public object allows in principle:
// a value of another kind in a field, a field removed or made an accessor, a frozen or sealed state, another prototype, heirs, proxies. The stream goes on working with such a state as it does in plain Bun.
function attempt(name, f) { try { console.log(name + ": " + String(f())); } catch (e) { console.log(name + ": THROWS " + String(e)); } }
const R = () => new Readable({ read() {} }), W = () => new Writable({ write(c, e, cb) { cb(); } }), D = () => new Duplex({ read() {}, write(c, e, cb) { cb(); } });
console.log("PART 1");
attempt("ws: reads", () => { const d = D(), r = d._readableState, w = d._writableState; return [r.endEmitted, r.ended, w.finished, w.errorEmitted, w.needDrain, w.length, w.ending, w.destroyed].join(); });
attempt("undici: buffer walk", () => { const r = R(); r.push("ab"); r.push("cd"); const s = r._readableState; let n = 0; if (s.bufferIndex) { for (let i = s.bufferIndex; i < s.buffer.length; i++) n += s.buffer[i].length; } else for (const c of s.buffer) n += c.length; return n + " " + s.length + " " + s.dataEmitted + " " + s.errorEmitted; });
attempt("got: autoDestroy = false", () => { const r = R(); r._readableState.autoDestroy = false; return r._readableState.autoDestroy; });
attempt("split2 / JSONStream: objectMode = true after construction", () => { const d = D(); d._readableState.objectMode = true; d._writableState.objectMode = true; d.push({ a: 1 }); return d.readableObjectMode + " " + d.writableObjectMode + " " + d._readableState.length; });
attempt("highWaterMark = n", () => { const d = D(); d._readableState.highWaterMark = 1; d._writableState.highWaterMark = 0; return d.readableHighWaterMark + " " + d.writableHighWaterMark; });
attempt("flags by name", () => { const r = R()._readableState; r.flowing = false; r.reading = true; r.needReadable = true; r.sync = false; r.ended = true; r.endEmitted = true; r.destroyed = true; r.emitClose = false; return [r.flowing, r.reading, r.needReadable, r.sync, r.ended, r.endEmitted, r.destroyed, r.emitClose].join(); });
attempt("flowing = null", () => { const r = R()._readableState; r.flowing = true; r.flowing = null; return r.flowing; });
attempt("truthy and falsy values for flags", () => { const r = R()._readableState; r.ended = 1; const a = r.ended; r.ended = ""; return a + " " + r.ended; });
attempt("stream-shift", () => { const r = R(); r.push("abc"); const s = r._readableState; return s.buffer.length + " " + (s.objectMode ? 1 : s.buffer[s.bufferIndex || 0].length); });
attempt("length = 0, buffer.length = 0", () => { const r = R(); r.push("abc"); const s = r._readableState; s.buffer.length = 0; s.length = 0; s.bufferIndex = 0; return r.readableLength; });
attempt("buffer = []", () => { const r = R(); r.push("abc"); r._readableState.buffer = []; r._readableState.length = 0; return r.readableBuffer.length; });
attempt("pipes, pipesCount", () => { const r = R(), w = W(); r.pipe(w); return r._readableState.pipes.length + " " + r._readableState.pipesCount + " " + (r._readableState.pipes[0] === w); });
attempt("decoder, encoding", () => { const r = R(); r.setEncoding("utf8"); const s = r._readableState; return typeof s.decoder + " " + s.encoding + " " + s.defaultEncoding; });
attempt("decoder = null", () => { const r = R(); r.setEncoding("utf8"); r._readableState.decoder = null; r._readableState.encoding = null; return r._readableState.decoder + " " + r.readableEncoding; });
attempt("errored", () => { const w = W(); const e = new Error("x"); w._writableState.errored = e; return (w.errored === e) + " " + (w._writableState.errored === e); });
attempt("writable side", () => { const w = W(), s = w._writableState; w.cork(); w.write("a"); w.write("b"); return [s.corked, s.bufferedRequestCount, s.getBuffer().length, s.getBuffer()[0].encoding, typeof s.getBuffer()[0].callback, s.pendingcb, s.writing, s.allBuffers, s.allNoop].join(); });
attempt("decodeStrings = false", () => { const w = W(); w._writableState.decodeStrings = false; return w._writableState.decodeStrings; });
attempt("onwrite called by hand", () => { let cb; const w = new Writable({ write(c, e, f) { cb = f; } }); w.write("a"); const same = cb === w._writableState.onwrite; w._writableState.onwrite(); return same + " " + w._writableState.writing; });
attempt("onwrite wrapped", () => { let called = 0; const w = W(), s = w._writableState, o = s.onwrite; s.onwrite = function (er) { called++; return o(er); }; w.write("a"); return called; });
attempt("writecb, afterWriteTickInfo, buffered", () => { const s = W()._writableState; return typeof s.writecb + " " + s.afterWriteTickInfo + " " + s.buffered.length; });
attempt("delete pendingcb (test-stream-finished.js)", () => { const w = W(); delete w._writableState.pendingcb; return w._writableState.pendingcb; });
attempt("extra properties", () => { const s = R()._readableState; s.awaitDrain = 0; s.mine = "x"; return s.awaitDrain + s.mine + " " + ("mine" in s); });
attempt("state shared with a wrapper", () => { const inner = W(); const outer = Object.create(Writable.prototype); outer._writableState = inner._writableState; return outer.writable + " " + outer.writableLength + " " + (outer instanceof Writable); });
attempt("state made again", () => { const r = R(); r._readableState = new Readable.ReadableState({ objectMode: true }, r, false); return r.readableObjectMode + " " + r.push({}); });
attempt("instanceof", () => (R()._readableState instanceof Readable.ReadableState) + " " + (W()._writableState instanceof Writable.WritableState) + " " + ({ _writableState: W()._writableState } instanceof Writable));
attempt("a mock state on a real prototype", () => { const f = Object.create(Readable.prototype); f._readableState = { destroyed: true, endEmitted: false, length: 3, flowing: null, objectMode: true }; return [f.destroyed, f.readableEnded, f.readableLength, f.readableFlowing, f.readableObjectMode, f.readable].join(); });
attempt("a mock state on a real Writable prototype", () => { const f = Object.create(Writable.prototype); f._writableState = { length: 3, highWaterMark: 7, corked: 1 }; f.destroyed = true; return [f.destroyed, f.writableFinished, f.writableLength, f.writableHighWaterMark, f.writableCorked, f.writable].join(); });
attempt("no state at all", () => { const f = Object.create(Duplex.prototype); return [f.destroyed, f.readable, f.writable, f.readableEnded, f.writableFinished, f.closed, f.errored].join(); });
console.log("PART 2");
attempt("keys", () => Object.keys(R()._readableState).join() + " | " + Object.keys(W()._writableState).join());
attempt("JSON", () => JSON.stringify(R()._readableState));
attempt("Object.assign, spread", () => Object.keys(Object.assign({}, R()._readableState)).length + " " + Object.keys({ ...W()._writableState }).length);
attempt("field of another type: length = '5'", () => { const s = R()._readableState; s.length = "5"; return typeof s.length; });
attempt("field of another type: highWaterMark = undefined", () => { const s = R()._readableState; s.highWaterMark = undefined; return s.highWaterMark; });
attempt("field of another type: highWaterMark = null", () => { const s = W()._writableState; s.highWaterMark = null; return s.highWaterMark; });
attempt("field of another type: pipes = null", () => { const s = R()._readableState; s.pipes = null; return s.pipes; });
attempt("field of another type: buffer = a list object", () => { const s = R()._readableState; s.buffer = { head: null, tail: null, length: 0 }; return typeof s.buffer; });
attempt("field of another type: onwrite = null", () => { const s = W()._writableState; s.onwrite = null; return s.onwrite; });
attempt("field of another type: corked = true", () => { const s = W()._writableState; s.corked = true; return s.corked; });
attempt("field of another type: flags = 1.5", () => { const s = W()._writableState; s.flags = 1.5; return s.flags; });
attempt("delete a field", () => { const s = R()._readableState; delete s.awaitDrainWriters; return "awaitDrainWriters" in s; });
attempt("delete length", () => { const s = R()._readableState; delete s.length; return s.length; });
attempt("defineProperty: a field made an accessor", () => { const s = R()._readableState; let n = 0; Object.defineProperty(s, "length", { get() { n++; return 0; }, set() {}, configurable: true }); return s.length + " " + n; });
attempt("defineProperty: a field made read-only", () => { const s = R()._readableState; Object.defineProperty(s, "highWaterMark", { value: 5, writable: false }); try { s.highWaterMark = 6; } catch {} return s.highWaterMark; });
attempt("freeze", () => { const s = R()._readableState; Object.freeze(s); return Object.isFrozen(s); });
attempt("seal", () => { const s = R()._readableState; Object.seal(s); return Object.isSealed(s); });
attempt("preventExtensions", () => { const s = R()._readableState; Object.preventExtensions(s); return Object.isExtensible(s); });
attempt("setPrototypeOf", () => { const s = R()._readableState; Object.setPrototypeOf(s, { hello: 1 }); return s.hello + " " + s.ended; });
attempt("heir", () => { class H extends Readable.ReadableState { get mine() { return 1; } } const h = new H({ objectMode: true }); return h.mine + " " + h.objectMode + " " + (h instanceof Readable.ReadableState); });
attempt("called without new", () => { const o = {}; Readable.ReadableState.call(o, {}, null, false); return Object.keys(o).length > 0; });
attempt("Reflect.construct with another new.target", () => { function T() {} const s = Reflect.construct(Readable.ReadableState, [{}], T); return (s instanceof T) + " " + s.highWaterMark; });
attempt("Proxy around a state", () => { const r = R(); r._readableState = new Proxy(r._readableState, {}); return r.readableLength + " " + r.push("a"); });
attempt("Proxy around a stream", () => { const p = new Proxy(R(), {}); return p.readableLength + " " + p.push("a") + " " + p.readableLength; });
attempt("heir of a state (Object.create)", () => { const r = R(); r._readableState = Object.create(r._readableState); return r.readableLength + " " + r.push("a"); });
console.log("PART 3");
// The stream is used after its state was altered in a way that leaves every field what it was.
function use(r) { const pushed = r.push("ab"); const first = String(r.read()); r.push("cd"); return [pushed, first, r.readableLength, r.readableFlowing, r.readableEnded, r.destroyed, String(r.read(1)), r._readableState.length].join(); }
function write(w) { const a = w.write("ab"); w.cork(); w.write("cd"); const buffered = w.writableLength; w.uncork(); return [a, buffered, w.writableLength, w.writableCorked, w.writableNeedDrain, w.writableEnded, w._writableState.pendingcb].join(); }
const alterations = [
  ["nothing", s => s],
  ["a field removed and stored again", s => { const n = s.length; delete s.length; s.length = n; }],
  ["a field that holds anything removed", s => { delete s.erroredValue; }],
  ["an accessor over highWaterMark", s => { let n = s.highWaterMark; Object.defineProperty(s, "highWaterMark", { get() { return n; }, set(v) { n = v; }, configurable: true, enumerable: true }); }],
  ["a field hidden", s => { Object.defineProperty(s, "length", { enumerable: false }); }],
  ["sealed", s => { Object.seal(s); }],
  ["not extensible", s => { Object.preventExtensions(s); }],
  ["an heir of its prototype for a prototype", s => { Object.setPrototypeOf(s, Object.create(Object.getPrototypeOf(s))); }],
  ["more properties", s => { s.mine = 1; s[0] = "zero"; s[Symbol.for("mine")] = 2; }],
];
for (const [name, alter] of alterations) {
  attempt("a readable, " + name, () => { const r = R(); alter(r._readableState); return use(r) + " | " + Object.keys(r._readableState).join(); });
  attempt("a readable in use, " + name, () => { const r = R(); r.push("xy"); alter(r._readableState); return use(r); });
  attempt("a writable, " + name, () => { const w = W(); alter(w._writableState); return write(w) + " | " + Object.keys(w._writableState).join(); });
  attempt("a duplex, " + name, () => { const d = D(); alter(d._readableState); alter(d._writableState); return use(d) + " | " + write(d); });
}
attempt("altered by a listener in the middle of a read", () => { const r = R(); r.once("data", () => { delete r._readableState.erroredValue; r._readableState.mine = 1; Object.seal(r._readableState); }); r.push("ab"); r.resume(); r.push("cd"); return [r.readableLength, r.readableFlowing, "mine" in r._readableState].join(); });
attempt("a frozen state", () => { const r = R(); Object.freeze(r._readableState); try { r.push("ab"); return "pushed"; } catch (e) { return e.constructor.name; } });
