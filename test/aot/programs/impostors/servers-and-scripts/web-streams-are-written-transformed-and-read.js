const log = [];
const source = new ReadableStream(
  {
    start(controller) {
      log.push("start " + controller.desiredSize);
    },
    pull(controller) {
      const n = (this.n = (this.n ?? 0) + 1);
      log.push("pull " + n);
      if (n > 4) controller.close();
      else controller.enqueue(n);
    },
    cancel(reason) {
      log.push("cancel " + reason);
    },
  },
  new CountQueuingStrategy({ highWaterMark: 2 }),
);
const doubled = source.pipeThrough(
  new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk * 2);
      if (chunk === 2) controller.enqueue("extra");
    },
    flush(controller) {
      controller.enqueue("flushed");
    },
  }),
);
const written = [];
await doubled.pipeTo(
  new WritableStream({
    write(chunk) {
      written.push(chunk);
    },
    close() {
      written.push("closed");
    },
  }),
);
console.log(written, log.filter(line => line.startsWith("pull")).length, source.locked);

const cancelled = new ReadableStream({ pull: controller => controller.enqueue("x"), cancel: reason => void log.push("cancelled because " + reason) });
const reader = cancelled.getReader();
console.log(await reader.read(), cancelled.locked);
await reader.cancel("enough");
console.log(await reader.read(), log.at(-1));
reader.releaseLock();

const failing = new ReadableStream({ start: controller => controller.error(new RangeError("broken source")) });
console.log(await failing.getReader().read().catch(error => error.message));
const writer = new WritableStream({ write: chunk => { if (chunk === "bad") throw new TypeError("refused"); } }).getWriter();
await writer.write("good");
console.log(await writer.write("bad").catch(error => error.message), await writer.closed.catch(error => error.name), writer.desiredSize);

const bytes = new ReadableStream({ type: "bytes", start(controller) { controller.enqueue(new Uint8Array([1, 2, 3, 4, 5])); controller.close(); } });
const byob = bytes.getReader({ mode: "byob" });
const first = await byob.read(new Uint8Array(3));
const second = await byob.read(new Uint8Array(3));
console.log(first.value, second.value, (await byob.read(new Uint8Array(1))).done);

const values = [];
for await (const value of ReadableStream.from?.(["a", "b"]) ?? ["a", "b"]) values.push(value);
console.log(values, await new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("to a ")); c.enqueue(new TextEncoder().encode("response")); c.close(); } })).text());
const direct = new ReadableStream({ type: "direct", async pull(controller) { controller.write("direct "); await controller.flush(); controller.write("stream"); controller.close(); } });
console.log(await new Response(direct).text(), new ByteLengthQueuingStrategy({ highWaterMark: 9 }).size(new Uint8Array(4)), typeof TextDecoderStream, typeof CompressionStream);
