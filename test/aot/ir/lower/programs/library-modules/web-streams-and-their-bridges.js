// RUN: lower
// OPTIONS: builtin-modules

// node:stream/web and the global stream classes: a ReadableStream with a controller, a TransformStream, a WritableStream, tee, text encoder and decoder streams, compression, and the bridges to node:stream.
import { ReadableStream, TransformStream, WritableStream, TextDecoderStream, TextEncoderStream, CompressionStream, DecompressionStream } from "node:stream/web";
import { Readable, Writable } from "node:stream";

const numbers = () => new ReadableStream({ start(controller) { for (const n of [1, 2, 3]) controller.enqueue(n); controller.close(); } });
const doubled = numbers().pipeThrough(new TransformStream({ transform(n, controller) { controller.enqueue(n * 2); } }));
const seen = [];
await doubled.pipeTo(new WritableStream({ write(n) { seen.push(n); } }));
console.log(seen.join());

const [left, right] = numbers().tee();
const read = async stream => { const all = []; for await (const value of stream) all.push(value); return all.join(); };
console.log(await read(left), await read(right));

const words = new ReadableStream({ start(controller) { controller.enqueue("grüße"); controller.close(); } });
console.log(await read(words.pipeThrough(new TextEncoderStream()).pipeThrough(new TextDecoderStream())));

const packed = new Response("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").body.pipeThrough(new CompressionStream("gzip"));
console.log(await new Response(packed.pipeThrough(new DecompressionStream("gzip"))).text());

console.log(await read(Readable.toWeb(Readable.from(["a", "b"]))));
const fromWeb = [];
for await (const value of Readable.fromWeb(numbers(), { objectMode: true })) fromWeb.push(value);
console.log(fromWeb.join());
const sink = [];
const writer = Writable.toWeb(new Writable({ write(chunk, encoding, done) { sink.push(chunk.toString()); done(); } })).getWriter();
await writer.write("through the bridge");
await writer.close();
console.log(sink.join());

const reader = numbers().getReader();
console.log(JSON.stringify(await reader.read()), numbers().locked, ReadableStream === globalThis.ReadableStream);
const failing = new ReadableStream({ pull() { throw new RangeError("pull failed"); } });
console.log(await failing.getReader().read().catch(error => error.name + " " + error.message));

// GENERATED: numbers transform read pull
// CHECK-LABEL: function {{*}}name="numbers"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="ReadableStream"
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(NodeStreamWebReadableStream) flags=[IsExpected]}
// CHECK-NEXT: v3 = NewClosure function=[[f_2]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v5 = NewObject layout=[[L_4]]
// CHECK-NEXT: PropDefine v5, v4 key="start"
// CHECK-NEXT: v7 = FinishObject v5
// CHECK-NEXT: v8 = Construct v2, -, v7 calleeName="ReadableStream"
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="transform"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|[[L_5]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_5]]):
// CHECK-NEXT: v2 = PropGet v1 key="enqueue"
// CHECK-NEXT: v3 = Integer integer=2
// CHECK-NEXT: v4 = Mul v0, v3
// CHECK-NEXT: v5 = Call v2, v1, v4 calleeKey="enqueue" calleeName="controller.enqueue"
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsAsync] length=1 syntax=[HasWrittenAwait] thisType={type=anything} parameters=[{type=undefined|null|[[L_6]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_6]]):
// CHECK-NEXT: v1 = Data data=[[d_7]]
// CHECK-NEXT: v2 = IteratorOpen v0 iteratorKind=Async
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v4 = IteratorResume v2, -, v0 iteratorKind=Async
// CHECK-NEXT: v5 = ResultAt v4
// CHECK-NEXT: v6 = ResultAt v4 index=1
// CHECK-NEXT: Branch v5 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v7 = PropGet v1 key="join"
// CHECK-NEXT: v8 = Call v7, v1 calleeKey="join" calleeName="all.join"
// CHECK-NEXT: Return v8
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b5():
// CHECK-NEXT: v9 = PropGet v1 key="push"
// CHECK-NEXT: v10 = Call v9, v1, v6 calleeKey="push" calleeName="all.push"
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b5() role=IterationCleanup subject=v2:
// CHECK-NEXT: v11 = CatchException
// CHECK-NEXT: IteratorClose v2, v0 iteratorKind=Async completion=Throw
// CHECK-NEXT: Rethrow v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="pull"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="RangeError" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(RangeError) flags=[IsExpected]}
// CHECK-NEXT: v3 = String string="pull failed"
// CHECK-NEXT: v4 = Construct v2, -, v3 calleeName="RangeError"
// CHECK-NEXT: Throw v4
// CHECK-NEXT: }
