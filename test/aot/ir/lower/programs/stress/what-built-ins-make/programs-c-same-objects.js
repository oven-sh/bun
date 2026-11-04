// RUN: lower
// OPTIONS: builtin-modules

// What a module of Bun exports under the name of a global is that global: one object, however it is reached.
import AbortControllerDefault, { AbortController as AbortControllerNamed, AbortSignal as AbortSignalNamed } from "abort-controller";
import * as buffer from "node:buffer";
import * as url from "node:url";
import * as util from "node:util";
import * as perfHooks from "node:perf_hooks";
import * as workerThreads from "node:worker_threads";
import * as streamWeb from "node:stream/web";
import * as events from "node:events";
import * as http from "node:http";
import * as undici from "undici";
import * as ws from "ws";
import * as nodeConsole from "node:console";
import * as path from "node:path";
import * as pathPosix from "node:path/posix";
import * as stream from "node:stream";
import * as crypto from "node:crypto";
import * as timers from "node:timers";
import * as processModule from "node:process";
import * as stringDecoder from "node:string_decoder";
import * as moduleModule from "node:module";
const lines = [];
function compare(moduleName, namespace, names) {
  const different = names.filter(name => namespace[name] !== globalThis[name]);
  lines.push(`${moduleName}: ${names.length - different.length} of ${names.length} are the globals${different.length ? ", not " + different.join() : ""}`);
}
console.log("abort-controller", AbortControllerDefault === globalThis.AbortController, AbortControllerDefault === AbortController, AbortControllerNamed === AbortController, AbortSignalNamed === AbortSignal, require("abort-controller") === AbortController, new AbortControllerDefault() instanceof AbortController);
console.log("node:buffer", buffer.Blob === Blob, buffer.File === File, buffer.Buffer === Buffer, buffer.atob === atob, buffer.btoa === btoa, buffer.default.Buffer === Buffer, buffer.default.File === File);
console.log("node:url", url.URL === URL, url.URLSearchParams === URLSearchParams, url.URLPattern === globalThis.URLPattern, url.default.URL === URL);
console.log("node:util", util.TextEncoder === TextEncoder, util.TextDecoder === TextDecoder, util.default.TextDecoder === TextDecoder);
console.log("node:perf_hooks", perfHooks.performance === performance, perfHooks.Performance === Performance, perfHooks.PerformanceEntry === PerformanceEntry, perfHooks.PerformanceMark === PerformanceMark, perfHooks.PerformanceMeasure === PerformanceMeasure, perfHooks.PerformanceObserver === PerformanceObserver, perfHooks.PerformanceObserverEntryList === PerformanceObserverEntryList, perfHooks.PerformanceResourceTiming === PerformanceResourceTiming);
console.log("node:worker_threads", workerThreads.MessageChannel === MessageChannel, workerThreads.MessagePort === MessagePort, workerThreads.BroadcastChannel === BroadcastChannel, workerThreads.Worker === Worker);
compare("node:stream/web", streamWeb, ["ByteLengthQueuingStrategy", "CompressionStream", "CountQueuingStrategy", "DecompressionStream", "ReadableByteStreamController", "ReadableStream", "ReadableStreamBYOBReader", "ReadableStreamBYOBRequest", "ReadableStreamDefaultController", "ReadableStreamDefaultReader", "TextDecoderStream", "TextEncoderStream", "TransformStream", "TransformStreamDefaultController", "WritableStream", "WritableStreamDefaultController", "WritableStreamDefaultWriter"]);
console.log("node:stream/web", streamWeb.ReadableStream === ReadableStream, streamWeb.WritableStream === WritableStream, streamWeb.TransformStream === TransformStream, streamWeb.CountQueuingStrategy === CountQueuingStrategy, streamWeb.TextDecoderStream === TextDecoderStream);
console.log("node:http", http.CloseEvent === CloseEvent, http.MessageEvent === MessageEvent, http.WebSocket === WebSocket);
console.log("undici", undici.File === File, undici.FormData === FormData, undici.Headers === Headers, undici.Request === Request, undici.Response === Response, undici.fetch === fetch, undici.CloseEvent === CloseEvent, undici.ErrorEvent === ErrorEvent, undici.MessageEvent === MessageEvent, undici.WebSocket === WebSocket, undici.EventSource === globalThis.EventSource);
console.log("ws", ws.WebSocket === WebSocket, ws.default === ws.WebSocket);
console.log("node:console", nodeConsole.default === console, require("node:console") === console, nodeConsole.log === console.log);
console.log("node:path", path.default === path.posix, pathPosix.default === path.default, require("node:path") === require("node:path/posix"), path.posix === pathPosix.default, path.win32 === path.default);
console.log("node:stream", require("node:_stream_wrap") === require("node:stream"), stream.default === require("node:stream"), stream.default.Stream === stream.default);
console.log("node:crypto", crypto.webcrypto === globalThis.crypto, crypto.subtle === globalThis.crypto.subtle, crypto.getRandomValues === globalThis.crypto.getRandomValues);
console.log("node:timers", timers.setTimeout === setTimeout, timers.clearTimeout === clearTimeout, timers.setInterval === setInterval, timers.setImmediate === setImmediate, timers.clearImmediate === clearImmediate);
console.log("node:process", processModule.default === process, processModule.nextTick === process.nextTick, require("node:process") === process);
console.log("node:events", events.default === events.EventEmitter, events.default.EventEmitter === events.default);
console.log("node:string_decoder", stringDecoder.StringDecoder === stringDecoder.default.StringDecoder, require("string_decoder").StringDecoder === stringDecoder.StringDecoder);
console.log("node:module", moduleModule.default === moduleModule.Module, moduleModule.builtinModules === moduleModule.default.builtinModules);
console.log("Bun", Bun.sql === Bun.postgres, Bun.fetch === fetch, Bun.env === process.env, Bun.argv === process.argv, BuildError === BuildMessage, ResolveError === ResolveMessage, globalThis.self === globalThis);
for (const line of lines) console.log(line);

// GENERATED: compare
// CHECK-LABEL: function {{*}}name="compare"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|object flags=[IsExpected]}, {type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|object, v2: undefined|null|Array<undefined|null|string>):
// CHECK-NEXT: v3 = PropGet v2 key="filter"
// CHECK-NEXT: v4 = NewClosure v1 function=[[f_1]]
// CHECK-NEXT: v5 = Call v3, v2, v4 calleeKey="filter" calleeName="names.filter"
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="lines"
// CHECK-NEXT: v8 = PropGet v7 key="push"
// CHECK-NEXT: v9 = ToString v0
// CHECK-NEXT: v10 = String string=": "
// CHECK-NEXT: v11 = PropGet v2 key="length"
// CHECK-NEXT: v12 = PropGet v5 key="length"
// CHECK-NEXT: v13 = Sub v11, v12
// CHECK-NEXT: v14 = ToString v13
// CHECK-NEXT: v15 = String string=" of "
// CHECK-NEXT: v16 = PropGet v2 key="length"
// CHECK-NEXT: v17 = ToString v16
// CHECK-NEXT: v18 = String string=" are the globals"
// CHECK-NEXT: v19 = PropGet v5 key="length"
// CHECK-NEXT: v20 = ToBoolean v19
// CHECK-NEXT: Branch v20 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v21):
// CHECK-NEXT: v22 = String string=", not "
// CHECK-NEXT: v23 = PropGet v5 key="join"
// CHECK-NEXT: v24 = Call v23, v5 calleeKey="join" calleeName="different.join"
// CHECK-NEXT: v25 = Add v22, v24
// CHECK-NEXT: Jump -> next b3(v25)
// CHECK-NEXT: b2(v26):
// CHECK-NEXT: v27 = String string=""
// CHECK-NEXT: Jump -> next b3(v27)
// CHECK-NEXT: b3(v28):
// CHECK-NEXT: v29 = ToString v28
// CHECK-NEXT: v30 = Strcat v9, v10, v14, v15, v17, v18, v29
// CHECK-NEXT: v31 = Call v8, v7, v30 calleeKey="push" calleeName="lines.push"
// CHECK-NEXT: v32 = Undefined
// CHECK-NEXT: Return v32
// CHECK-NEXT: }
