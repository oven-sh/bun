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
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="ReadableStream"
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(NodeStreamWebReadableStream) flags=[IsExpected]}
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v4 = NewClosure function=[[f_5]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v6 = NewObject layout=[[L_7]]
// CHECK-NEXT: PropDefine v6, v5 key="start"
// CHECK-NEXT: v8 = FinishObject v6
// CHECK-NEXT: v9 = Construct v3, -, v8 calleeName="ReadableStream"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="transform"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|[[L_8]] flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_8]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v1 key="enqueue"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[f_10]] flags=[IsExpected]}
// CHECK-NEXT: v4 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v5 = Integer integer=2
// CHECK-NEXT: v6 = Mul v4, v5
// CHECK-NEXT: v7 = Call v3, v1, v6 calleeKey="enqueue" calleeName="controller.enqueue"
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsAsync] length=1 syntax=[HasWrittenAwait] thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] results=[{type=undefined|null|Promise<undefined|null|string> flags=[IsExpected]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Data data=[[d_12]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v4 = IteratorOpen v0 iteratorKind=Async
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v6 = IteratorResume v4, -, v0 iteratorKind=Async
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Branch v7 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v9 = PropGet v3 key="join"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[f_13]] flags=[IsExpected]}
// CHECK-NEXT: v11 = Call v10, v3 calleeKey="join" calleeName="all.join"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|string|object flags=[IsExpected]}
// CHECK-NEXT: Return v13
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b6():
// CHECK-NEXT: v14 = PropGet v3 key="push"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[f_14]] flags=[IsExpected]}
// CHECK-NEXT: v16 = Call v15, v3, v8 calleeKey="push" calleeName="all.push"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b6() role=IterationCleanup subject=v4:
// CHECK-NEXT: v17 = CatchException
// CHECK-NEXT: IteratorClose v4, v0 iteratorKind=Async completion=Throw
// CHECK-NEXT: Rethrow v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="pull"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_15]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="RangeError" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(RangeError) flags=[IsExpected]}
// CHECK-NEXT: v3 = String string="pull failed"
// CHECK-NEXT: v4 = Construct v2, -, v3 calleeName="RangeError"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|RangeError flags=[IsExpected]}
// CHECK-NEXT: Throw v5
// CHECK-NEXT: }
