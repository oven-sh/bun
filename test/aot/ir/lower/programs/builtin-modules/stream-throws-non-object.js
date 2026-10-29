// RUN: lower
// OPTIONS: builtin-modules

const stream = require("node:stream");
const { Readable, Writable, Duplex, Transform, PassThrough, pipeline, finished, compose, addAbortSignal } = stream;
const promises = require("node:stream/promises");
const { once } = require("node:events");

const show = value => (typeof value === "symbol" ? String(value) : typeof value === "bigint" ? value + "n" : typeof value === "string" ? JSON.stringify(value) : value instanceof Error ? value.name + " " + (value.code ?? "") + (value.cause !== undefined ? " cause " + show(value.cause) : "") + (value.errors ? " [" + value.errors.map(show).join() + "]" : "") : typeof value === "object" && value !== null ? "object" : String(value));
let notes = [];
const note = text => notes.push(text);
process.on("uncaughtException", error => note("UNCAUGHT " + show(error)));
process.on("unhandledRejection", error => note("UNHANDLED " + show(error)));
const watch = (title, emitter) => {
  for (const name of ["error", "close", "end", "finish"]) emitter.on(name, argument => note(title + " " + name + (name === "error" ? " " + show(argument) : "")));
  return emitter;
};
const settle = async (title, promise) => {
  try {
    note(title + " resolves " + show(await promise));
  } catch (error) {
    note(title + " rejects " + show(error));
  }
};
const drain = async readable => {
  for await (const chunk of readable) note("chunk " + show(chunk));
};
const sink = () => new Writable({ objectMode: true, write(chunk, encoding, callback) { callback(); } });
const source = () => Readable.from(["a", "b", "c"]);

const roads = {
  "from an async generator that throws": x => settle("for await", drain(Readable.from((async function* () { throw x; })()))),
  "from an async generator that throws behind a chunk": x => settle("for await", drain(Readable.from((async function* () { yield 1; throw x; })()))),
  "from a generator that throws": x => settle("for await", drain(Readable.from((function* () { yield 1; throw x; })()))),
  "from a generator that yields a rejected promise": x => settle("for await", drain(Readable.from((function* () { yield Promise.reject(x); })()))),
  "from an async generator that yields a rejected promise": x => settle("for await", drain(Readable.from((async function* () { yield Promise.reject(x); })()))),
  "from an iterator whose next rejects": x => settle("for await", drain(Readable.from({ [Symbol.asyncIterator]() { return { next: () => Promise.reject(x) }; } }))),
  "from an iterator whose next throws": x => settle("for await", drain(Readable.from({ [Symbol.iterator]() { return { next() { throw x; } }; } }))),
  "from, listened to": x => new Promise(resolve => watch("readable", Readable.from((async function* () { throw x; })())).on("close", resolve).resume()),
  "from, whose return throws": x => settle("for await", (async () => { for await (const chunk of Readable.from({ [Symbol.asyncIterator]() { return { next: async () => ({ done: false, value: 1 }), return() { throw x; } }; } })) break; })()),
  map: x => settle("toArray", source().map(() => { throw x; }).toArray()),
  "map, async": x => settle("toArray", source().map(async () => { throw x; }).toArray()),
  filter: x => settle("toArray", source().filter(() => { throw x; }).toArray()),
  flatMap: x => settle("toArray", source().flatMap(() => { throw x; }).toArray()),
  forEach: x => settle("forEach", source().forEach(() => { throw x; })),
  some: x => settle("some", source().some(() => { throw x; })),
  every: x => settle("every", source().every(() => { throw x; })),
  find: x => settle("find", source().find(() => { throw x; })),
  reduce: x => settle("reduce", source().reduce(() => { throw x; }, 0)),
  "toArray of a stream that fails": x => settle("toArray", Readable.from((async function* () { yield 1; throw x; })()).toArray()),
  "take of a stream that fails": x => settle("toArray", Readable.from((async function* () { throw x; })()).take(2).toArray()),
  "drop of a stream that fails": x => settle("toArray", Readable.from((async function* () { throw x; })()).drop(1).toArray()),
  "fromWeb of a stream that errors": x => settle("for await", drain(Readable.fromWeb(new ReadableStream({ start(controller) { controller.error(x); } })))),
  "fromWeb of a stream whose pull throws": x => settle("for await", drain(Readable.fromWeb(new ReadableStream({ pull() { throw x; } })))),
  "toWeb of a stream that is destroyed": async x => { const readable = watch("readable", new Readable({ read() {} })); const reader = Readable.toWeb(readable).getReader(); readable.destroy(x); await settle("read", reader.read()); },
  "Writable.fromWeb whose write throws": x => new Promise(resolve => { const writable = watch("writable", Writable.fromWeb(new WritableStream({ write() { throw x; } }))); writable.on("close", resolve); writable.write("a", error => note("callback " + show(error))); }),
  "destroy of a readable": x => new Promise(resolve => watch("readable", new Readable({ read() {} })).on("close", resolve).destroy(x)),
  "destroy of a writable": x => new Promise(resolve => watch("writable", sink()).on("close", resolve).destroy(x)),
  "destroy of a duplex": x => new Promise(resolve => watch("duplex", new PassThrough()).on("close", resolve).destroy(x)),
  "destroy with a callback": x => new Promise(resolve => watch("readable", new Readable({ read() {} })).on("close", resolve).destroy(x, error => note("callback " + show(error)))),
  "destroy, then errored": async x => { const readable = watch("readable", new Readable({ read() {} })); readable.destroy(x); note("errored " + show(readable.errored)); await once(readable, "close"); note("errored " + show(readable.errored)); },
  "destroy while it is iterated": x => { const readable = new Readable({ read() {} }); const promise = settle("for await", drain(readable)); readable.destroy(x); return promise; },
  "_read throws": x => new Promise(resolve => watch("readable", new Readable({ read() { throw x; } })).on("close", resolve).resume()),
  "_read destroys": x => new Promise(resolve => watch("readable", new Readable({ read() { this.destroy(x); } })).on("close", resolve).resume()),
  "_destroy hands it on": x => new Promise(resolve => watch("readable", new Readable({ read() {}, destroy(error, callback) { callback(x); } })).on("close", resolve).destroy()),
  "_destroy throws": x => new Promise(resolve => { const readable = watch("readable", new Readable({ read() {}, destroy() { throw x; } })); readable.on("close", resolve); readable.destroy(); }),
  "_construct hands it on": x => new Promise(resolve => { const readable = watch("readable", new Readable({ read() {}, construct(callback) { callback(x); } })).on("close", resolve); setImmediate(() => readable.destroy()); }),
  "_construct throws": x => new Promise(resolve => { const writable = watch("writable", new Writable({ write() {}, construct() { throw x; } })).on("close", resolve); setImmediate(() => writable.destroy()); }),
  "_write hands it on": x => new Promise(resolve => { const writable = watch("writable", new Writable({ write(chunk, encoding, callback) { callback(x); } })); writable.on("close", resolve); writable.write("a", error => note("callback " + show(error))); if (!x) writable.end(); }),
  "_write hands it on later": x => new Promise(resolve => { const writable = watch("writable", new Writable({ write(chunk, encoding, callback) { setImmediate(callback, x); } })); writable.on("close", resolve); writable.write("a", error => note("callback " + show(error))); writable.write("b", error => note("second callback " + show(error))); if (!x) writable.end(); }),
  "_write throws": x => new Promise(resolve => { const writable = watch("writable", new Writable({ write() { throw x; } })); writable.on("close", resolve); try { writable.write("a", error => note("callback " + show(error))); } catch (error) { note("write throws " + show(error)); writable.destroy(); } }),
  "_writev hands it on": x => new Promise(resolve => { const writable = watch("writable", new Writable({ writev(chunks, callback) { callback(x); } })); writable.on("close", resolve); writable.cork(); writable.write("a", error => note("callback " + show(error))); writable.write("b"); writable.uncork(); if (!x) writable.end(); }),
  "_final hands it on": x => new Promise(resolve => { const writable = watch("writable", new Writable({ write(chunk, encoding, callback) { callback(); }, final(callback) { callback(x); } })); writable.on("close", resolve); writable.end(error => note("callback " + show(error))); }),
  "_final throws": x => new Promise(resolve => { const writable = watch("writable", new Writable({ write(chunk, encoding, callback) { callback(); }, final() { throw x; } })); writable.on("close", resolve); writable.end(); }),
  "_transform hands it on": x => new Promise(resolve => { const transform = watch("transform", new Transform({ transform(chunk, encoding, callback) { callback(x); } })); transform.on("close", resolve); transform.resume(); transform.end("a"); }),
  "_transform throws": x => new Promise(resolve => { const transform = watch("transform", new Transform({ transform() { throw x; } })); transform.on("close", resolve); transform.resume(); try { transform.end("a"); } catch (error) { note("end throws " + show(error)); transform.destroy(); } }),
  "_flush hands it on": x => new Promise(resolve => { const transform = watch("transform", new Transform({ transform(chunk, encoding, callback) { callback(); }, flush(callback) { callback(x); } })); transform.on("close", resolve); transform.resume(); transform.end("a"); }),
  "emit error": x => new Promise(resolve => { const readable = watch("readable", new Readable({ read() {} })); readable.emit("error", x); readable.on("close", resolve); readable.destroy(); }),
  "finished of a stream that is destroyed": x => new Promise(resolve => { const readable = watch("readable", new Readable({ read() {} })); finished(readable, error => { note("finished " + show(error)); resolve(); }); readable.destroy(x); }),
  "finished, as a promise": x => { const writable = watch("writable", sink()); const promise = settle("finished", promises.finished(writable)); writable.destroy(x); return promise; },
  "finished of a stream that had failed": async x => { const readable = watch("readable", new Readable({ read() {} })); readable.destroy(x); await once(readable, "close"); await settle("finished", promises.finished(readable)); },
  "finished with a signal": x => { const controller = new AbortController(); const promise = settle("finished", promises.finished(new Readable({ read() {} }), { signal: controller.signal })); controller.abort(x); return promise; },
  "pipeline whose source throws": x => new Promise(resolve => pipeline((async function* () { yield "a"; throw x; })(), sink(), error => { note("pipeline " + show(error)); resolve(); })),
  "pipeline whose source function throws": x => new Promise(resolve => pipeline(async function* () { throw x; }, sink(), error => { note("pipeline " + show(error)); resolve(); })),
  "pipeline whose transform throws": x => new Promise(resolve => pipeline(source(), async function* (chunks) { for await (const chunk of chunks) throw x; }, sink(), error => { note("pipeline " + show(error)); resolve(); })),
  "pipeline whose last function rejects": x => new Promise(resolve => pipeline(source(), async chunks => { throw x; }, (error, value) => { note("pipeline " + show(error) + " " + show(value)); resolve(); })),
  "pipeline whose source stream is destroyed": x => new Promise(resolve => { const readable = new Readable({ read() {} }); pipeline(readable, new PassThrough(), sink(), error => { note("pipeline " + show(error)); resolve(); }); readable.destroy(x); }),
  "pipeline whose middle is destroyed": x => new Promise(resolve => { const middle = new PassThrough(); pipeline(new Readable({ read() {} }), middle, sink(), error => { note("pipeline " + show(error)); resolve(); }); middle.destroy(x); }),
  "pipeline whose sink fails": x => new Promise(resolve => pipeline(source(), new Writable({ objectMode: true, write(chunk, encoding, callback) { callback(x); } }), error => { note("pipeline " + show(error)); resolve(); })),
  "pipeline whose two ends fail": x => new Promise(resolve => { const readable = new Readable({ read() {} }); const writable = sink(); pipeline(readable, writable, error => { note("pipeline " + show(error)); resolve(); }); readable.destroy(x); writable.destroy(x); }),
  "pipeline from a web stream that errors": x => new Promise(resolve => pipeline(new ReadableStream({ start(controller) { controller.error(x); } }), sink(), error => { note("pipeline " + show(error)); resolve(); })),
  "pipeline from a web stream": x => new Promise(resolve => pipeline(new ReadableStream({ start(controller) { controller.enqueue(x ?? "nothing"); controller.close(); } }), sink(), error => { note("pipeline " + show(error)); resolve(); })),
  "pipeline through a web transform that throws": x => new Promise(resolve => pipeline(source(), new TransformStream({ transform() { throw x; } }), sink(), error => { note("pipeline " + show(error)); resolve(); })),
  "pipeline through a web transform": x => new Promise(resolve => pipeline(source(), new TransformStream(), sink(), error => { note("pipeline " + show(error)); resolve(); })),
  "pipeline whose function returns a web stream that errors": x => new Promise(resolve => pipeline(source(), () => new ReadableStream({ start(controller) { controller.error(x); } }), sink(), error => { note("pipeline " + show(error)); resolve(); })),
  "pipeline whose last function returns a web stream": x => new Promise(resolve => pipeline(source(), () => new ReadableStream({ start(controller) { controller.error(x); } }), error => { note("pipeline " + show(error)); resolve(); }).on("error", () => {}).resume()),
  "pipeline into a web stream whose write throws": x => new Promise(resolve => pipeline(source(), new WritableStream({ write() { throw x; } }), error => { note("pipeline " + show(error)); resolve(); })),
  "pipeline, as a promise": x => settle("pipeline", promises.pipeline((async function* () { throw x; })(), sink())),
  "pipeline with a signal": x => { const controller = new AbortController(); const promise = settle("pipeline", promises.pipeline(new Readable({ read() {} }), sink(), { signal: controller.signal })); controller.abort(x); return promise; },
  "pipe, and the source fails": x => new Promise(resolve => { const readable = watch("readable", new Readable({ read() {} })); const writable = watch("writable", sink()); readable.pipe(writable); readable.on("close", resolve); readable.destroy(x); }),
  "pipe, and the sink fails": x => new Promise(resolve => { const readable = watch("readable", source()); const writable = watch("writable", new Writable({ objectMode: true, write(chunk, encoding, callback) { callback(x); } })); readable.pipe(writable); writable.on("close", () => setImmediate(resolve)); if (!x) readable.on("end", () => setImmediate(resolve)); }),
  "compose whose function throws": x => settle("for await", drain(compose(source(), async function* (chunks) { for await (const chunk of chunks) throw x; }))),
  "compose that is destroyed": x => new Promise(resolve => watch("composed", compose(new PassThrough(), new PassThrough())).on("close", resolve).destroy(x)),
  "addAbortSignal": x => new Promise(resolve => { const controller = new AbortController(); watch("readable", addAbortSignal(controller.signal, new Readable({ read() {} }))).on("close", resolve); controller.abort(x); }),
  "a signal in the options": x => new Promise(resolve => { const controller = new AbortController(); watch("writable", new Writable({ write() {}, signal: controller.signal })).on("close", resolve); controller.abort(x); }),
  "Duplex.from an async function that rejects": x => new Promise(resolve => { const duplex = watch("duplex", Duplex.from(async chunks => { throw x; })); duplex.on("close", resolve); duplex.end("a"); }),
  "Duplex.from an async generator function that throws": x => settle("for await", drain(Duplex.from(async function* (chunks) { throw x; }))),
  "Duplex.from a promise that rejects": x => settle("for await", drain(Duplex.from(Promise.reject(x)))),
  "Duplex.from a pair, and the readable fails": x => new Promise(resolve => { const readable = new Readable({ read() {} }); watch("duplex", Duplex.from({ readable, writable: sink() })).on("close", resolve); readable.destroy(x); }),
  "an iterator that does not destroy on return": async x => { const readable = watch("readable", new Readable({ read() {} })); const promise = settle("for await", (async () => { for await (const chunk of readable.iterator({ destroyOnReturn: false })) note("chunk"); })()); readable.destroy(x); await promise; },
  "the body of for await throws": x => { const readable = watch("readable", source()); return settle("for await", (async () => { for await (const chunk of readable) throw x; })()); },
  "once error": x => { const readable = new Readable({ read() {} }); const promise = settle("once", Promise.race([once(readable, "end"), new Promise(resolve => readable.on("close", () => setImmediate(resolve, "closed")))])); readable.destroy(x); return promise; },
  "unshift behind a failure": x => new Promise(resolve => { const readable = watch("readable", new Readable({ read() {} })); readable.on("close", resolve); readable.destroy(x); readable.unshift("a"); readable.push("b"); }),
  "write behind a failure": x => new Promise(resolve => { const writable = watch("writable", sink()); writable.on("close", () => setImmediate(resolve)); writable.destroy(x); writable.write("a", error => note("callback " + show(error))); writable.end(error => note("end callback " + show(error))); }),
  "stream.destroy": x => new Promise(resolve => { const readable = watch("readable", new Readable({ read() {} })); readable.on("close", resolve); stream.destroy(readable, x); }),
};

const values = ["text", "", 7, 0, NaN, true, false, null, undefined, Symbol("mine"), 10n];
(async () => {
  for (const road of Object.keys(roads)) {
    for (const value of values) {
      notes = [];
      let timer;
      try {
        const late = new Promise(resolve => (timer = setTimeout(resolve, 3000, "late")));
        if ((await Promise.race([roads[road](value), late])) === "late") note("LATE");
      } catch (error) {
        note("the road throws " + show(error));
      }
      clearTimeout(timer);
      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => setImmediate(resolve));
      console.log(road + " | " + show(value) + ": " + notes.join(" . "));
    }
  }
})();

// GENERATED: note drain addAbortSignal [Symbol.iterator] next
// CHECK-LABEL: function {{*}}name="note"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] length=1 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}] results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetEnvironmentField v0 layout=[[L_1]] field=1
// CHECK-NEXT: v3 = CheckInitialized v2 name="notes"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v6 = Call v5, v3, v1 calleeKey="push" calleeName="notes.push"
// CHECK-NEXT: v7 = Convert v6 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="drain"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsAsync, IsSloppy] length=1 syntax=[HasWrittenAwait] captures=[{type=undefined|null|[[f_4]] flags=[IsExpected]}, {type=undefined|null|[[f_2]] flags=[IsExpected]}] thisType={type=anything} parameters=[{type=undefined|null|[[L_5]]|[[L_6]] flags=[IsExpected]}] results=[{type=undefined|null|Promise flags=[IsExpected]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_4]], v1: undefined|null|[[f_2]], v2: undefined|null|[[L_5]]|[[L_6]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = IteratorOpen v2 iteratorKind=Async
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v5 = IteratorResume v3, -, v2 iteratorKind=Async
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Branch v6 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b6():
// CHECK-NEXT: v9 = Convert v7 declared={type=undefined|null|string|symbol|bigint|Error flags=[IsExpected]}
// CHECK-NEXT: v10 = String string="chunk "
// CHECK-NEXT: v11 = Call v0, -, v9 calleeName="show"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v13 = Add v10, v12
// CHECK-NEXT: v14 = Call v1, -, v13 calleeName="note"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b6() role=IterationCleanup subject=v3:
// CHECK-NEXT: v15 = CatchException
// CHECK-NEXT: IteratorClose v3, v2 iteratorKind=Async completion=Throw
// CHECK-NEXT: Rethrow v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="addAbortSignal"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] length=1 captures=[{type=undefined|null|[[f_8]] flags=[IsExpected]}, {type=undefined|null|[[f_9]] flags=[IsExpected]}, {type=undefined|null|[[f_10]] flags=[IsExpected]}] thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|Promise flags=[IsExpected]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_8]], v1: undefined|null|[[f_9]], v2: undefined|null|[[f_10]], v3: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = Builtin builtin=GlobalThis
// CHECK-NEXT: v5 = PropGet v4 key="Promise" [isFreeName]
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(Promise) flags=[IsExpected]}
// CHECK-NEXT: v7 = NewClosure v0, v1, v2, v3 function=[[f_12]]
// CHECK-NEXT: v8 = Construct v6, -, v7 calleeName="Promise"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|Promise flags=[IsExpected]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.iterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsSloppy, IsNamedByComputedKey] captures=[{type=anything}] thisType={type=anything} results=[{type=undefined|null|[[L_13]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewClosure v0 function=[[f_14]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_15]] flags=[IsExpected]}
// CHECK-NEXT: v3 = NewObject layout=[[L_13]]
// CHECK-NEXT: PropDefine v3, v2 key="next"
// CHECK-NEXT: v5 = FinishObject v3
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_13]] flags=[IsExpected]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="next"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] captures=[{type=anything}] thisType={type=anything} results=[{type=undefined|null|Promise<undefined|null|[[L_16]]> flags=[IsExpected]}] functionTypes={{*}}[[f_17]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="Promise" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Promise) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="reject"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(PromiseReject) flags=[IsExpected]}
// CHECK-NEXT: v6 = Call v5, v3, v0 calleeKey="reject" calleeName="Promise.reject"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|Promise<undefined|null|[[L_16]]> flags=[IsExpected]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="next"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsSloppy, HasExplicitName] captures=[{type=anything}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_15]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Throw v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="next"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsAsync, IsSloppy] thisType={type=anything} results=[{type=undefined|null|Promise<undefined|null|[[L_16]]> flags=[IsExpected]}] functionTypes={{*}}[[f_18]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_19]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
