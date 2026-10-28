// Each global in turn: a script declares `let` under its name. Either the declaration is refused and compiled code goes on seeing the global, or it is admitted and compiled code sees the binding from then on, although it has read the global before.
const vm = require("node:vm");
const print = console.log;
const isSame = Object.is;
const reads = {
  AbortController: () => AbortController, AbortSignal: () => AbortSignal, AggregateError: () => AggregateError, Array: () => Array, ArrayBuffer: () => ArrayBuffer,
  AsyncDisposableStack: () => AsyncDisposableStack, Atomics: () => Atomics, BigInt: () => BigInt, BigInt64Array: () => BigInt64Array,
  BigUint64Array: () => BigUint64Array, Blob: () => Blob, Boolean: () => Boolean, BroadcastChannel: () => BroadcastChannel, Buffer: () => Buffer,
  BuildError: () => BuildError, BuildMessage: () => BuildMessage, Bun: () => Bun, ByteLengthQueuingStrategy: () => ByteLengthQueuingStrategy,
  CloseEvent: () => CloseEvent, CompressionStream: () => CompressionStream, CountQueuingStrategy: () => CountQueuingStrategy, Crypto: () => Crypto,
  CryptoKey: () => CryptoKey, CustomEvent: () => CustomEvent, DOMException: () => DOMException, DataView: () => DataView, Date: () => Date,
  DecompressionStream: () => DecompressionStream, DisposableStack: () => DisposableStack, Error: () => Error, ErrorEvent: () => ErrorEvent, EvalError: () => EvalError,
  Event: () => Event, EventTarget: () => EventTarget, File: () => File, FinalizationRegistry: () => FinalizationRegistry, Float16Array: () => Float16Array,
  Float32Array: () => Float32Array, Float64Array: () => Float64Array, FormData: () => FormData, Function: () => Function, HTMLRewriter: () => HTMLRewriter,
  Headers: () => Headers, Infinity: () => Infinity, Int16Array: () => Int16Array, Int32Array: () => Int32Array, Int8Array: () => Int8Array, Intl: () => Intl,
  Iterator: () => Iterator, JSON: () => JSON, Map: () => Map, Math: () => Math, MessageChannel: () => MessageChannel, MessageEvent: () => MessageEvent,
  MessagePort: () => MessagePort, NaN: () => NaN, Number: () => Number, Object: () => Object, Performance: () => Performance, PerformanceEntry: () => PerformanceEntry,
  PerformanceMark: () => PerformanceMark, PerformanceMeasure: () => PerformanceMeasure, PerformanceObserver: () => PerformanceObserver,
  PerformanceObserverEntryList: () => PerformanceObserverEntryList, PerformanceResourceTiming: () => PerformanceResourceTiming,
  PerformanceServerTiming: () => PerformanceServerTiming, PerformanceTiming: () => PerformanceTiming, Promise: () => Promise, Proxy: () => Proxy,
  RangeError: () => RangeError, ReadableByteStreamController: () => ReadableByteStreamController, ReadableStream: () => ReadableStream,
  ReadableStreamBYOBReader: () => ReadableStreamBYOBReader, ReadableStreamBYOBRequest: () => ReadableStreamBYOBRequest,
  ReadableStreamDefaultController: () => ReadableStreamDefaultController, ReadableStreamDefaultReader: () => ReadableStreamDefaultReader,
  ReferenceError: () => ReferenceError, Reflect: () => Reflect, RegExp: () => RegExp, Request: () => Request, ResolveError: () => ResolveError,
  ResolveMessage: () => ResolveMessage, Response: () => Response, Set: () => Set, ShadowRealm: () => ShadowRealm, SharedArrayBuffer: () => SharedArrayBuffer,
  String: () => String, SubtleCrypto: () => SubtleCrypto, SuppressedError: () => SuppressedError, Symbol: () => Symbol, SyntaxError: () => SyntaxError,
  Temporal: () => Temporal, TextDecoder: () => TextDecoder, TextDecoderStream: () => TextDecoderStream, TextEncoder: () => TextEncoder,
  TextEncoderStream: () => TextEncoderStream, TransformStream: () => TransformStream, TransformStreamDefaultController: () => TransformStreamDefaultController,
  TypeError: () => TypeError, URIError: () => URIError, URL: () => URL, URLPattern: () => URLPattern, URLSearchParams: () => URLSearchParams,
  Uint16Array: () => Uint16Array, Uint32Array: () => Uint32Array, Uint8Array: () => Uint8Array, Uint8ClampedArray: () => Uint8ClampedArray, WeakMap: () => WeakMap,
  WeakRef: () => WeakRef, WeakSet: () => WeakSet, WebAssembly: () => WebAssembly, WebSocket: () => WebSocket, Worker: () => Worker, WritableStream: () => WritableStream,
  WritableStreamDefaultController: () => WritableStreamDefaultController, WritableStreamDefaultWriter: () => WritableStreamDefaultWriter,
  addEventListener: () => addEventListener, alert: () => alert, atob: () => atob, btoa: () => btoa, clearImmediate: () => clearImmediate,
  clearInterval: () => clearInterval, clearTimeout: () => clearTimeout, confirm: () => confirm, console: () => console, crypto: () => crypto, decodeURI: () => decodeURI,
  decodeURIComponent: () => decodeURIComponent, dispatchEvent: () => dispatchEvent, encodeURI: () => encodeURI, encodeURIComponent: () => encodeURIComponent,
  escape: () => escape, eval: () => eval, fetch: () => fetch, global: () => global, globalThis: () => globalThis, isFinite: () => isFinite, isNaN: () => isNaN,
  navigator: () => navigator, onerror: () => onerror, onmessage: () => onmessage, parseFloat: () => parseFloat, parseInt: () => parseInt, performance: () => performance,
  postMessage: () => postMessage, process: () => process, prompt: () => prompt, queueMicrotask: () => queueMicrotask, removeEventListener: () => removeEventListener,
  reportError: () => reportError, self: () => self, setImmediate: () => setImmediate, setInterval: () => setInterval, setTimeout: () => setTimeout,
  structuredClone: () => structuredClone, undefined: () => undefined, unescape: () => unescape,
};
const absent = {};
function valueOf(read) {
  try { return read(); } catch { return absent; }
}

const wrong = [];
for (const name in reads) {
  const before = valueOf(reads[name]);
  let expected = "of the script";
  try {
    vm.runInThisContext("let " + name + " = 'of the script'");
  } catch (error) {
    if (error.name !== "SyntaxError") wrong.push(name + " (" + error.name + ")");
    expected = before;
  }
  if (!isSame(valueOf(reads[name]), expected)) wrong.push(name);
}
print(wrong.length ? "compiled code does not see what was declared: " + wrong.join(" ") : "compiled code sees what was declared");
