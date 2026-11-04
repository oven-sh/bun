const report = value => console.log(typeof value === "string" ? value : String(value));
// Generated: classes that share a prototype object, a kind of cell or a row of classes, each asked about the values of all.
const show = (value) => value === true ? "1" : value === false ? "0" : String(value);
function attempt(act) { try { return act(); } catch (error) { return "T"; } }
function maybe(name, make, values) { try { values.push([name, make()]); } catch (error) { values.push([name + ", which cannot be made: " + error.name, undefined]); } }

function isReadableStream(x) { return x instanceof ReadableStream; }
function countReadableStream(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof ReadableStream) count++; } return count; }
function isWritableStream(x) { return x instanceof WritableStream; }
function countWritableStream(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof WritableStream) count++; } return count; }
function isTransformStream(x) { return x instanceof TransformStream; }
function countTransformStream(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof TransformStream) count++; } return count; }
function isTextDecoderStream(x) { return x instanceof TextDecoderStream; }
function countTextDecoderStream(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof TextDecoderStream) count++; } return count; }
function isTextEncoderStream(x) { return x instanceof TextEncoderStream; }
function countTextEncoderStream(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof TextEncoderStream) count++; } return count; }
function isCompressionStream(x) { return x instanceof CompressionStream; }
function countCompressionStream(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof CompressionStream) count++; } return count; }
function isDecompressionStream(x) { return x instanceof DecompressionStream; }
function countDecompressionStream(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof DecompressionStream) count++; } return count; }
function isByteLengthQueuingStrategy(x) { return x instanceof ByteLengthQueuingStrategy; }
function countByteLengthQueuingStrategy(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof ByteLengthQueuingStrategy) count++; } return count; }
function isCountQueuingStrategy(x) { return x instanceof CountQueuingStrategy; }
function countCountQueuingStrategy(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof CountQueuingStrategy) count++; } return count; }
function isReadableStreamDefaultReader(x) { return x instanceof ReadableStreamDefaultReader; }
function countReadableStreamDefaultReader(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof ReadableStreamDefaultReader) count++; } return count; }
function isWritableStreamDefaultWriter(x) { return x instanceof WritableStreamDefaultWriter; }
function countWritableStreamDefaultWriter(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof WritableStreamDefaultWriter) count++; } return count; }
const tests = [["ReadableStream", isReadableStream, countReadableStream], ["WritableStream", isWritableStream, countWritableStream], ["TransformStream", isTransformStream, countTransformStream], ["TextDecoderStream", isTextDecoderStream, countTextDecoderStream], ["TextEncoderStream", isTextEncoderStream, countTextEncoderStream], ["CompressionStream", isCompressionStream, countCompressionStream], ["DecompressionStream", isDecompressionStream, countDecompressionStream], ["ByteLengthQueuingStrategy", isByteLengthQueuingStrategy, countByteLengthQueuingStrategy], ["CountQueuingStrategy", isCountQueuingStrategy, countCountQueuingStrategy], ["ReadableStreamDefaultReader", isReadableStreamDefaultReader, countReadableStreamDefaultReader], ["WritableStreamDefaultWriter", isWritableStreamDefaultWriter, countWritableStreamDefaultWriter]];
const values = [];
maybe("created below ReadableStream.prototype", () => Object.create(ReadableStream.prototype), values);
maybe("ReadableStream.prototype", () => ReadableStream.prototype, values);
maybe("ReadableStream", () => ReadableStream, values);
maybe("new ReadableStream", () => new ReadableStream(), values);
maybe("new of a class below ReadableStream", () => new (class extends ReadableStream {})(), values);
maybe("new ReadableStream without its prototype", () => Object.setPrototypeOf(new ReadableStream(), null), values);
maybe("new ReadableStream below WritableStream.prototype", () => Object.setPrototypeOf(new ReadableStream(), WritableStream.prototype), values);
maybe("a proxy of new ReadableStream", () => new Proxy(new ReadableStream(), {}), values);
maybe("ReadableStream made for WritableStream as new.target", () => Reflect.construct(ReadableStream, [], WritableStream), values);
maybe("created below WritableStream.prototype", () => Object.create(WritableStream.prototype), values);
maybe("WritableStream.prototype", () => WritableStream.prototype, values);
maybe("WritableStream", () => WritableStream, values);
maybe("new WritableStream", () => new WritableStream(), values);
maybe("new of a class below WritableStream", () => new (class extends WritableStream {})(), values);
maybe("new WritableStream without its prototype", () => Object.setPrototypeOf(new WritableStream(), null), values);
maybe("new WritableStream below TransformStream.prototype", () => Object.setPrototypeOf(new WritableStream(), TransformStream.prototype), values);
maybe("a proxy of new WritableStream", () => new Proxy(new WritableStream(), {}), values);
maybe("WritableStream made for TransformStream as new.target", () => Reflect.construct(WritableStream, [], TransformStream), values);
maybe("created below TransformStream.prototype", () => Object.create(TransformStream.prototype), values);
maybe("TransformStream.prototype", () => TransformStream.prototype, values);
maybe("TransformStream", () => TransformStream, values);
maybe("new TransformStream", () => new TransformStream(), values);
maybe("new of a class below TransformStream", () => new (class extends TransformStream {})(), values);
maybe("new TransformStream without its prototype", () => Object.setPrototypeOf(new TransformStream(), null), values);
maybe("new TransformStream below TextDecoderStream.prototype", () => Object.setPrototypeOf(new TransformStream(), TextDecoderStream.prototype), values);
maybe("a proxy of new TransformStream", () => new Proxy(new TransformStream(), {}), values);
maybe("TransformStream made for TextDecoderStream as new.target", () => Reflect.construct(TransformStream, [], TextDecoderStream), values);
maybe("created below TextDecoderStream.prototype", () => Object.create(TextDecoderStream.prototype), values);
maybe("TextDecoderStream.prototype", () => TextDecoderStream.prototype, values);
maybe("TextDecoderStream", () => TextDecoderStream, values);
maybe("new TextDecoderStream", () => new TextDecoderStream(), values);
maybe("new of a class below TextDecoderStream", () => new (class extends TextDecoderStream {})(), values);
maybe("new TextDecoderStream without its prototype", () => Object.setPrototypeOf(new TextDecoderStream(), null), values);
maybe("new TextDecoderStream below TextEncoderStream.prototype", () => Object.setPrototypeOf(new TextDecoderStream(), TextEncoderStream.prototype), values);
maybe("a proxy of new TextDecoderStream", () => new Proxy(new TextDecoderStream(), {}), values);
maybe("TextDecoderStream made for TextEncoderStream as new.target", () => Reflect.construct(TextDecoderStream, [], TextEncoderStream), values);
maybe("created below TextEncoderStream.prototype", () => Object.create(TextEncoderStream.prototype), values);
maybe("TextEncoderStream.prototype", () => TextEncoderStream.prototype, values);
maybe("TextEncoderStream", () => TextEncoderStream, values);
maybe("new TextEncoderStream", () => new TextEncoderStream(), values);
maybe("new of a class below TextEncoderStream", () => new (class extends TextEncoderStream {})(), values);
maybe("new TextEncoderStream without its prototype", () => Object.setPrototypeOf(new TextEncoderStream(), null), values);
maybe("new TextEncoderStream below CompressionStream.prototype", () => Object.setPrototypeOf(new TextEncoderStream(), CompressionStream.prototype), values);
maybe("a proxy of new TextEncoderStream", () => new Proxy(new TextEncoderStream(), {}), values);
maybe("TextEncoderStream made for CompressionStream as new.target", () => Reflect.construct(TextEncoderStream, [], CompressionStream), values);
maybe("created below CompressionStream.prototype", () => Object.create(CompressionStream.prototype), values);
maybe("CompressionStream.prototype", () => CompressionStream.prototype, values);
maybe("CompressionStream", () => CompressionStream, values);
maybe("new CompressionStream", () => new CompressionStream("gzip"), values);
maybe("new of a class below CompressionStream", () => new (class extends CompressionStream {})("gzip"), values);
maybe("new CompressionStream without its prototype", () => Object.setPrototypeOf(new CompressionStream("gzip"), null), values);
maybe("new CompressionStream below DecompressionStream.prototype", () => Object.setPrototypeOf(new CompressionStream("gzip"), DecompressionStream.prototype), values);
maybe("a proxy of new CompressionStream", () => new Proxy(new CompressionStream("gzip"), {}), values);
maybe("CompressionStream made for DecompressionStream as new.target", () => Reflect.construct(CompressionStream, ["gzip"], DecompressionStream), values);
maybe("created below DecompressionStream.prototype", () => Object.create(DecompressionStream.prototype), values);
maybe("DecompressionStream.prototype", () => DecompressionStream.prototype, values);
maybe("DecompressionStream", () => DecompressionStream, values);
maybe("new DecompressionStream", () => new DecompressionStream("gzip"), values);
maybe("new of a class below DecompressionStream", () => new (class extends DecompressionStream {})("gzip"), values);
maybe("new DecompressionStream without its prototype", () => Object.setPrototypeOf(new DecompressionStream("gzip"), null), values);
maybe("new DecompressionStream below ByteLengthQueuingStrategy.prototype", () => Object.setPrototypeOf(new DecompressionStream("gzip"), ByteLengthQueuingStrategy.prototype), values);
maybe("a proxy of new DecompressionStream", () => new Proxy(new DecompressionStream("gzip"), {}), values);
maybe("DecompressionStream made for ByteLengthQueuingStrategy as new.target", () => Reflect.construct(DecompressionStream, ["gzip"], ByteLengthQueuingStrategy), values);
maybe("created below ByteLengthQueuingStrategy.prototype", () => Object.create(ByteLengthQueuingStrategy.prototype), values);
maybe("ByteLengthQueuingStrategy.prototype", () => ByteLengthQueuingStrategy.prototype, values);
maybe("ByteLengthQueuingStrategy", () => ByteLengthQueuingStrategy, values);
maybe("new ByteLengthQueuingStrategy", () => new ByteLengthQueuingStrategy({ highWaterMark: 1 }), values);
maybe("new of a class below ByteLengthQueuingStrategy", () => new (class extends ByteLengthQueuingStrategy {})({ highWaterMark: 1 }), values);
maybe("new ByteLengthQueuingStrategy without its prototype", () => Object.setPrototypeOf(new ByteLengthQueuingStrategy({ highWaterMark: 1 }), null), values);
maybe("new ByteLengthQueuingStrategy below CountQueuingStrategy.prototype", () => Object.setPrototypeOf(new ByteLengthQueuingStrategy({ highWaterMark: 1 }), CountQueuingStrategy.prototype), values);
maybe("a proxy of new ByteLengthQueuingStrategy", () => new Proxy(new ByteLengthQueuingStrategy({ highWaterMark: 1 }), {}), values);
maybe("ByteLengthQueuingStrategy made for CountQueuingStrategy as new.target", () => Reflect.construct(ByteLengthQueuingStrategy, [{ highWaterMark: 1 }], CountQueuingStrategy), values);
maybe("created below CountQueuingStrategy.prototype", () => Object.create(CountQueuingStrategy.prototype), values);
maybe("CountQueuingStrategy.prototype", () => CountQueuingStrategy.prototype, values);
maybe("CountQueuingStrategy", () => CountQueuingStrategy, values);
maybe("new CountQueuingStrategy", () => new CountQueuingStrategy({ highWaterMark: 1 }), values);
maybe("new of a class below CountQueuingStrategy", () => new (class extends CountQueuingStrategy {})({ highWaterMark: 1 }), values);
maybe("new CountQueuingStrategy without its prototype", () => Object.setPrototypeOf(new CountQueuingStrategy({ highWaterMark: 1 }), null), values);
maybe("new CountQueuingStrategy below ReadableStreamDefaultReader.prototype", () => Object.setPrototypeOf(new CountQueuingStrategy({ highWaterMark: 1 }), ReadableStreamDefaultReader.prototype), values);
maybe("a proxy of new CountQueuingStrategy", () => new Proxy(new CountQueuingStrategy({ highWaterMark: 1 }), {}), values);
maybe("CountQueuingStrategy made for ReadableStreamDefaultReader as new.target", () => Reflect.construct(CountQueuingStrategy, [{ highWaterMark: 1 }], ReadableStreamDefaultReader), values);
maybe("created below ReadableStreamDefaultReader.prototype", () => Object.create(ReadableStreamDefaultReader.prototype), values);
maybe("ReadableStreamDefaultReader.prototype", () => ReadableStreamDefaultReader.prototype, values);
maybe("ReadableStreamDefaultReader", () => ReadableStreamDefaultReader, values);
maybe("new ReadableStreamDefaultReader", () => new ReadableStreamDefaultReader(new ReadableStream()), values);
maybe("new of a class below ReadableStreamDefaultReader", () => new (class extends ReadableStreamDefaultReader {})(new ReadableStream()), values);
maybe("new ReadableStreamDefaultReader without its prototype", () => Object.setPrototypeOf(new ReadableStreamDefaultReader(new ReadableStream()), null), values);
maybe("new ReadableStreamDefaultReader below WritableStreamDefaultWriter.prototype", () => Object.setPrototypeOf(new ReadableStreamDefaultReader(new ReadableStream()), WritableStreamDefaultWriter.prototype), values);
maybe("a proxy of new ReadableStreamDefaultReader", () => new Proxy(new ReadableStreamDefaultReader(new ReadableStream()), {}), values);
maybe("ReadableStreamDefaultReader made for WritableStreamDefaultWriter as new.target", () => Reflect.construct(ReadableStreamDefaultReader, [new ReadableStream()], WritableStreamDefaultWriter), values);
maybe("created below WritableStreamDefaultWriter.prototype", () => Object.create(WritableStreamDefaultWriter.prototype), values);
maybe("WritableStreamDefaultWriter.prototype", () => WritableStreamDefaultWriter.prototype, values);
maybe("WritableStreamDefaultWriter", () => WritableStreamDefaultWriter, values);
maybe("new WritableStreamDefaultWriter", () => new WritableStreamDefaultWriter(new WritableStream()), values);
maybe("new of a class below WritableStreamDefaultWriter", () => new (class extends WritableStreamDefaultWriter {})(new WritableStream()), values);
maybe("new WritableStreamDefaultWriter without its prototype", () => Object.setPrototypeOf(new WritableStreamDefaultWriter(new WritableStream()), null), values);
maybe("new WritableStreamDefaultWriter below ReadableStream.prototype", () => Object.setPrototypeOf(new WritableStreamDefaultWriter(new WritableStream()), ReadableStream.prototype), values);
maybe("a proxy of new WritableStreamDefaultWriter", () => new Proxy(new WritableStreamDefaultWriter(new WritableStream()), {}), values);
maybe("WritableStreamDefaultWriter made for ReadableStream as new.target", () => Reflect.construct(WritableStreamDefaultWriter, [new WritableStream()], ReadableStream), values);
maybe("new TransformStream().readable", () => (new TransformStream().readable), values);
maybe("new TransformStream().writable", () => (new TransformStream().writable), values);
maybe("new ReadableStream().getReader()", () => (new ReadableStream().getReader()), values);
maybe(`new ReadableStream({ type: "bytes" }).getReader({ mode: "byob" })`, () => (new ReadableStream({ type: "bytes" }).getReader({ mode: "byob" })), values);
maybe("new WritableStream().getWriter()", () => (new WritableStream().getWriter()), values);
maybe(`new Response("a").body`, () => (new Response("a").body), values);
maybe(`new Blob(["a"]).stream()`, () => (new Blob(["a"]).stream()), values);
maybe("new ReadableStream().tee()[0]", () => (new ReadableStream().tee()[0]), values);
maybe("new TextDecoderStream().readable", () => (new TextDecoderStream().readable), values);
for (const [name, value] of values) {
  let answers = "";
  for (const [, is, count] of tests) answers += show(attempt(() => is(value))) + show(attempt(() => count(value)));
  report(answers + " " + name);
}
const ordinary = Function.prototype[Symbol.hasInstance];
report("ReadableStream: " + (ReadableStream[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(ReadableStream, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(ReadableStream, value))) + show(attempt(() => ReadableStream[Symbol.hasInstance](value)))).join(""));
report("WritableStream: " + (WritableStream[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(WritableStream, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(WritableStream, value))) + show(attempt(() => WritableStream[Symbol.hasInstance](value)))).join(""));
report("TransformStream: " + (TransformStream[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(TransformStream, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(TransformStream, value))) + show(attempt(() => TransformStream[Symbol.hasInstance](value)))).join(""));
report("TextDecoderStream: " + (TextDecoderStream[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(TextDecoderStream, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(TextDecoderStream, value))) + show(attempt(() => TextDecoderStream[Symbol.hasInstance](value)))).join(""));
report("TextEncoderStream: " + (TextEncoderStream[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(TextEncoderStream, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(TextEncoderStream, value))) + show(attempt(() => TextEncoderStream[Symbol.hasInstance](value)))).join(""));
report("CompressionStream: " + (CompressionStream[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(CompressionStream, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(CompressionStream, value))) + show(attempt(() => CompressionStream[Symbol.hasInstance](value)))).join(""));
report("DecompressionStream: " + (DecompressionStream[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(DecompressionStream, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(DecompressionStream, value))) + show(attempt(() => DecompressionStream[Symbol.hasInstance](value)))).join(""));
report("ByteLengthQueuingStrategy: " + (ByteLengthQueuingStrategy[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(ByteLengthQueuingStrategy, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(ByteLengthQueuingStrategy, value))) + show(attempt(() => ByteLengthQueuingStrategy[Symbol.hasInstance](value)))).join(""));
report("CountQueuingStrategy: " + (CountQueuingStrategy[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(CountQueuingStrategy, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(CountQueuingStrategy, value))) + show(attempt(() => CountQueuingStrategy[Symbol.hasInstance](value)))).join(""));
report("ReadableStreamDefaultReader: " + (ReadableStreamDefaultReader[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(ReadableStreamDefaultReader, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(ReadableStreamDefaultReader, value))) + show(attempt(() => ReadableStreamDefaultReader[Symbol.hasInstance](value)))).join(""));
report("WritableStreamDefaultWriter: " + (WritableStreamDefaultWriter[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(WritableStreamDefaultWriter, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(WritableStreamDefaultWriter, value))) + show(attempt(() => WritableStreamDefaultWriter[Symbol.hasInstance](value)))).join(""));
process.exit(0);
