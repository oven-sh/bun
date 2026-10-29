// What the constructors of WritableStream, TransformStream and TextEncoderStream answer, with and without operands; the functions of a sink and of a transformer are called by nobody but native code.
const say = (...values: unknown[]) => console.log(...values);
const empty = new WritableStream();
say(empty.locked, empty instanceof WritableStream, Object.getPrototypeOf(empty) === WritableStream.prototype);
const written: string[] = [];
const sink = new WritableStream<string>({
  start(controller) { written.push("start " + typeof controller.error); },
  write(chunk) { written.push("write " + chunk); },
  close() { written.push("close"); },
}, { highWaterMark: { valueOf() { written.push("the mark is converted"); return 2; } } as unknown as number, size(chunk) { written.push("size " + chunk); return 1; } });
const writer = sink.getWriter();
say(sink.locked); await writer.write("a"); await writer.write("b"); await writer.close(); say(written.join(", "));
const plain = new TransformStream();
say(plain.readable === plain.readable, plain.writable === plain.writable, plain.readable instanceof ReadableStream, plain.writable instanceof WritableStream, plain.readable.locked, plain.writable.locked);
const upper = new TransformStream<string, string>({ transform(chunk, controller) { controller.enqueue(chunk.toUpperCase()); }, flush(controller) { controller.enqueue("flushed"); } });
const upperWriter = upper.writable.getWriter(); upperWriter.write("shout"); upperWriter.close();
const chunks: string[] = []; for await (const chunk of upper.readable) chunks.push(chunk); say(chunks.join());
const encoder = new TextEncoderStream();
say(encoder.encoding.toUpperCase(), encoder.readable === encoder.readable, encoder.writable instanceof WritableStream);
const encoderWriter = encoder.writable.getWriter(); encoderWriter.write("é"); encoderWriter.close();
for await (const bytes of encoder.readable) say(bytes instanceof Uint8Array, [...bytes].join());
class Counting extends WritableStream<number> { count = 0; }
say(new Counting().count, new Counting() instanceof WritableStream, Object.getPrototypeOf(new Counting()) === Counting.prototype);
for (const wrong of [() => (WritableStream as any)(), () => (TransformStream as any)(), () => (TextEncoderStream as any)(), () => new WritableStream(1 as any), () => new TransformStream("x" as any), () => new WritableStream({ type: "bytes" } as any), () => new WritableStream({ start() { throw new RangeError("from start"); } }), () => Object.getOwnPropertyDescriptor(WritableStream.prototype, "locked")!.get!.call({})])
  try { say(typeof wrong()); } catch (e) { say((e as Error).name, (e as Error).message.slice(0, 40)); }
