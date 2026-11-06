// RUN: lower
// OPTIONS: builtin-modules

// node:util, node:events, node:stream and node:net are only in the executable because node:http needs them. require() with a computed name finds them, and every export has to work, not only the ones that node:http calls.
import { createServer } from "node:http";

console.log(typeof createServer);
const load = name => require(process.env.PREFIX + name);

function Child() {}
load("util").inherits(Child, Error);
console.log(Child.super_ === Error, new Child() instanceof Error);
console.log(load("util").format("%s:%d", "a", 1), load("util").isDeepStrictEqual({ a: [1] }, { a: [1] }));
console.log(await load("util").promisify(callback => callback(null, "promisified"))());
console.log(load("events").getEventListeners(new (load("events"))(), "x").length);
console.log(load("net").isIPv6("::1"), load("net").isIP("1.2.3.4"));
console.log((await load("stream").Readable.from(["a", "b"]).toArray()).join());

console.log(load("util").callbackify(async () => "called back").length, load("util")._extend({ a: 1 }, { b: 2 }).b);
console.log(load("util").getSystemErrorName(-2), load("util").types.isDate(new Date(0)), load("util").toUSVString("a\ud800"));
console.log(load("util").parseArgs({ args: ["--flag"], options: { flag: { type: "boolean" } } }).values.flag);
console.log(load("util").styleText("bold", "text") === "\x1b[1mtext\x1b[22m", load("util").stripVTControlCharacters("\x1b[1mtext\x1b[22m"));
console.log(load("events").listenerCount(new (load("events"))(), "x"), load("events").getMaxListeners(new (load("events"))()));
console.log((await load("events").once(new EventTarget(), "x", { signal: AbortSignal.abort() }).catch(error => error.name)));
console.log(load("net").isIPv4("1.2.3.4"), new (load("net").BlockList)().check("1.2.3.4"), load("net").getDefaultAutoSelectFamily());
console.log(load("stream").isReadable(new (load("stream").PassThrough)()), load("stream").getDefaultHighWaterMark(true));
console.log(await load("stream").promises.pipeline(load("stream").Readable.from(["a"]), new (load("stream").PassThrough)().resume()));

// GENERATED: Child load
// CHECK-LABEL: function {{*}}name="Child"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="load"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Process
// CHECK-NEXT: v2 = PropGet v1 key="env"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(ProcessEnv) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="PREFIX"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v6 = Add v5, v0
// CHECK-NEXT: v7 = RequireDynamic v6 referrer=[[m_0]]
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
