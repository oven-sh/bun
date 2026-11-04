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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=anything}, {type=undefined|null|[[L_1]] flags=[IsExpected]}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: anything, v2: undefined|null|[[L_1]], v3: anything):
// CHECK-NEXT: v4 = TypeTest v3 testedType=undefined
// CHECK-NEXT: Branch v4 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v5):
// CHECK-NEXT: v6 = Data data=[[d_2]]
// CHECK-NEXT: Jump -> next b3(v6)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: Jump -> next b3(v7)
// CHECK-NEXT: b3(v8):
// CHECK-NEXT: v9 = NewClosure v8 function=[[f_3]]
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="lines"
// CHECK-NEXT: v12 = PropGet v11 key="push"
// CHECK-NEXT: v13 = String string=": this "
// CHECK-NEXT: v14 = Add v0, v13
// CHECK-NEXT: v15 = CallDirect v8, v1 function=[[f_3]]
// CHECK-NEXT: v16 = Add v14, v15
// CHECK-NEXT: v17 = String string=", "
// CHECK-NEXT: v18 = Add v16, v17
// CHECK-NEXT: v19 = PropGet v2 key="length"
// CHECK-NEXT: v20 = Add v18, v19
// CHECK-NEXT: v21 = String string=": "
// CHECK-NEXT: v22 = Add v20, v21
// CHECK-NEXT: v23 = Builtin builtin=Array
// CHECK-NEXT: v24 = Builtin builtin=ArrayFrom
// CHECK-NEXT: v25 = Call v24, v23, v2, v9 calleeName="Array.from"
// CHECK-NEXT: v26 = PropGet v25 key="join"
// CHECK-NEXT: v27 = Call v26, v25 calleeKey="join" calleeName="join"
// CHECK-NEXT: v28 = Add v22, v27
// CHECK-NEXT: v29 = Call v12, v11, v28 calleeKey="push" calleeName="lines.push"
// CHECK-NEXT: v30 = Undefined
// CHECK-NEXT: Return v30
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="cancel"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasArgumentCount, HasHiddenRest, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: int[0, 4294967295], v2: anything, v3: Array):
// CHECK-NEXT: v4 = CreateUnmappedArguments v1, v3, v2
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v6 = String string="source.cancel"
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="source"
// CHECK-NEXT: v9 = NewObject -, v8 layout=[[L_7]] fields=[0]
// CHECK-NEXT: v10 = FinishObject v9
// CHECK-NEXT: v11 = Call v5, -, v6, v0, v4, v10 calleeName="seen"
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="element"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasArgumentCount, HasHiddenRest, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_8]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: int[0, 4294967295], v2: undefined|null|[[L_8]], v3: Array):
// CHECK-NEXT: v4 = CreateUnmappedArguments v1, v3, v2
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v6 = String string="element"
// CHECK-NEXT: v7 = Call v5, -, v6, v0, v4 calleeName="seen"
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="x"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, HasArgumentCount, HasHiddenRest, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: int[0, 4294967295], v2: Array):
// CHECK-NEXT: v3 = CreateUnmappedArguments v1, v2
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v5 = String string="getter under structuredClone"
// CHECK-NEXT: v6 = Call v4, -, v5, v0, v3 calleeName="seen"
// CHECK-NEXT: v7 = Integer integer=1
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
