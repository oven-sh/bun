// RUN: lower
// OPTIONS: builtin-modules

// What functions that are handed to streams, timers, events and observers see as `this` and as their arguments.
const lines = [];
function seen(name, self, given, known = {}) {
  const word = v => { for (const [k, o] of Object.entries(known)) if (o === v) return k; return v === undefined ? "undefined" : v === null ? "null" : v === globalThis ? "globalThis" : typeof v === "object" ? v.constructor?.name ?? "object" : typeof v; };
  lines.push(name + ": this " + word(self) + ", " + given.length + ": " + Array.from(given, word).join());
}
const source = {
  start(controller) { seen("source.start", this, arguments, { source }); },
  pull(controller) { seen("source.pull", this, arguments, { source }); controller.enqueue("a"); controller.close(); },
  cancel(reason) { seen("source.cancel", this, arguments, { source }); },
};
const strategy = { highWaterMark: 1, size(chunk) { seen("strategy.size", this, arguments, { strategy }); return 1; } };
for await (const chunk of new ReadableStream(source, strategy)) lines.push("chunk " + chunk);
const cancelled = new ReadableStream(source); await cancelled.cancel("why");
const sink = {
  start(controller) { seen("sink.start", this, arguments, { sink }); },
  write(chunk, controller) { seen("sink.write", this, arguments, { sink }); },
  close() { seen("sink.close", this, arguments, { sink }); },
  abort(reason) { seen("sink.abort", this, arguments, { sink }); },
};
const writer = new WritableStream(sink).getWriter(); await writer.write("w"); await writer.close();
await new WritableStream(sink).abort("why");
const transformer = {
  start(controller) { seen("transformer.start", this, arguments, { transformer }); },
  transform(chunk, controller) { seen("transformer.transform", this, arguments, { transformer }); controller.enqueue(chunk); },
  flush(controller) { seen("transformer.flush", this, arguments, { transformer }); },
};
const through = new TransformStream(transformer); const tw = through.writable.getWriter(); tw.write("t"); tw.close();
for await (const chunk of through.readable) lines.push("through " + chunk);
await new Promise(resolve => setTimeout(function () { seen("setTimeout", this, arguments); resolve(); }, 1, "x", 2));
await new Promise(resolve => setImmediate(function () { seen("setImmediate", this, arguments); resolve(); }, "x"));
await new Promise(resolve => { const id = setInterval(function () { seen("setInterval", this, arguments); clearInterval(id); resolve(); }, 1, "x"); });
await new Promise(resolve => queueMicrotask(function () { seen("queueMicrotask", this, arguments); resolve(); }));
await new Promise(resolve => process.nextTick(function () { seen("nextTick", this, arguments); resolve(); }, 1, 2));
const target = new EventTarget();
target.addEventListener("ping", function (event) { seen("listener", this, arguments, { target }); });
const listener = { handleEvent(event) { seen("handleEvent", this, arguments, { target, listener }); } };
target.addEventListener("ping", listener);
target.dispatchEvent(new Event("ping"));
const controller = new AbortController();
controller.signal.onabort = function (event) { seen("onabort", this, arguments, { signal: controller.signal }); };
controller.signal.addEventListener("abort", function (event) { seen("abort listener", this, arguments, { signal: controller.signal }); });
controller.abort();
const channel = new MessageChannel();
await new Promise(resolve => { channel.port1.onmessage = function (event) { seen("onmessage", this, arguments, { port1: channel.port1 }); resolve(); }; channel.port2.postMessage("m"); });
channel.port1.close(); channel.port2.close();
new HTMLRewriter().on("p", { element(e) { seen("element", this, arguments); }, text(t) { seen("text", this, arguments); }, comments(c) { seen("comments", this, arguments); } }).onDocument({ end(e) { seen("end", this, arguments); }, doctype(d) { seen("doctype", this, arguments); } }).transform("<!doctype html><p>a<!--c--></p>");
process.once("custom", function () { seen("process.once", this, arguments, { process }); }); process.emit("custom", 1, 2);
const registry = new FinalizationRegistry(function () {});
structuredClone({ get x() { seen("getter under structuredClone", this, arguments); return 1; } });
JSON.stringify({ toJSON(key) { seen("toJSON", this, arguments); return 1; } });
[3, 1].sort(function (a, b) { seen("sort", this, arguments); return a - b; });
"ab".replace(/a/, function () { seen("replace", this, arguments); return "x"; });
Array.from({ length: 1 }, function () { seen("Array.from", this, arguments); });
new Promise(function () { seen("executor", this, arguments); });
await Promise.resolve(1).then(function () { seen("then", this, arguments); });
await Promise.resolve(1).finally(function () { seen("finally", this, arguments); });
await { then(resolve) { seen("thenable", typeof this, arguments); resolve(); } };
Bun.inspect({ [Bun.inspect.custom](depth, options, inspect) { seen("inspect.custom", typeof this, arguments); return "x"; } });
console.log(lines.join("\n"));

// GENERATED: seen cancel element x
// CHECK-LABEL: function {{*}}name="seen"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=3 thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=undefined|null|string|Array flags=[IsExpected]}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: undefined|null|string|Array, v3: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = TypeTest v3 testedType=undefined
// CHECK-NEXT: Branch v4 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v6 = Data data=[[d_1]]
// CHECK-NEXT: Jump -> next b5(v6)
// CHECK-NEXT: b4(v7):
// CHECK-NEXT: Jump -> next b5(v7)
// CHECK-NEXT: b5(v8):
// CHECK-NEXT: v9 = NewClosure v8 function=[[f_2]]
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="lines"
// CHECK-NEXT: v13 = PropGet v12 key="push"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v15 = String string=": this "
// CHECK-NEXT: v16 = Add v0, v15
// CHECK-NEXT: v17 = Call v10, -, v1 calleeName="word"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v19 = Add v16, v18
// CHECK-NEXT: v20 = String string=", "
// CHECK-NEXT: v21 = Add v19, v20
// CHECK-NEXT: v22 = PropGet v2 key="length"
// CHECK-NEXT: v23 = Add v21, v22
// CHECK-NEXT: v24 = String string=": "
// CHECK-NEXT: v25 = Add v23, v24
// CHECK-NEXT: v26 = Builtin builtin=Array
// CHECK-NEXT: v27 = Builtin builtin=ArrayFrom
// CHECK-NEXT: v28 = Call v27, v26, v2, v10 calleeName="Array.from"
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v30 = PropGet v29 key="join"
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v32 = Call v31, v29 calleeKey="join" calleeName="join"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v34 = Add v25, v33
// CHECK-NEXT: v35 = Call v14, v12, v34 calleeKey="push" calleeName="lines.push"
// CHECK-NEXT: v36 = Undefined
// CHECK-NEXT: Return v36
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="cancel"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasArgumentCount, HasHiddenRest, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: anything, v1: int[0, 4294967295], v2: anything, v3: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = CreateUnmappedArguments v1, v3, v2
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v6 = String string="source.cancel"
// CHECK-NEXT: v7 = Convert v0 declared={type=undefined|null|[[L_9]] flags=[IsExpected]}
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="source"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[L_9]] flags=[IsExpected]}
// CHECK-NEXT: v11 = NewObject layout=[[L_11]]
// CHECK-NEXT: PropDefine v11, v10 key="source"
// CHECK-NEXT: v13 = FinishObject v11
// CHECK-NEXT: v14 = Call v5, -, v6, v7, v4, v13 calleeName="seen"
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="element"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasArgumentCount, HasHiddenRest, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_12]] flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0(v0: anything, v1: int[0, 4294967295], v2: undefined|null|[[L_12]], v3: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = CreateUnmappedArguments v1, v3, v2
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v6 = String string="element"
// CHECK-NEXT: v7 = Convert v0 declared={type=undefined|null|number|string|symbol|bigint|[[L_14]] flags=[IsExpected]}
// CHECK-NEXT: v8 = Call v5, -, v6, v7, v4 calleeName="seen"
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="x"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, HasArgumentCount, HasHiddenRest, HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: int[0, 4294967295], v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = CreateUnmappedArguments v1, v2
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v5 = String string="getter under structuredClone"
// CHECK-NEXT: v6 = Convert v0 declared={type=undefined|null|[[L_15]] flags=[IsExpected]}
// CHECK-NEXT: v7 = Call v4, -, v5, v6, v3 calleeName="seen"
// CHECK-NEXT: v8 = Integer integer=1
// CHECK-NEXT: v9 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
