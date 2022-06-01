import { file, gc } from "bun";
import { expect, it } from "bun:test";

it("exists globally", () => {
  expect(typeof ReadableStream).toBe("function");
  expect(typeof ReadableStreamBYOBReader).toBe("function");
  expect(typeof ReadableStreamBYOBRequest).toBe("function");
  expect(typeof ReadableStreamDefaultController).toBe("function");
  expect(typeof ReadableStreamDefaultReader).toBe("function");
  expect(typeof TransformStream).toBe("function");
  expect(typeof TransformStreamDefaultController).toBe("function");
  expect(typeof WritableStream).toBe("function");
  expect(typeof WritableStreamDefaultController).toBe("function");
  expect(typeof WritableStreamDefaultWriter).toBe("function");
  expect(typeof ByteLengthQueuingStrategy).toBe("function");
  expect(typeof CountQueuingStrategy).toBe("function");
});

it("ReadableStream", async () => {
  var stream = new ReadableStream({
    start(controller) {
      controller.enqueue(Buffer.from("abdefgh"));
    },
    pull(controller) {},
    cancel() {},
    type: "bytes",
  });
  const chunks = [];
  const chunk = await stream.getReader().read();
  chunks.push(chunk.value);
  expect(chunks[0].join("")).toBe(Buffer.from("abdefgh").join(""));
});

it("ReadableStream for Blob", async () => {
  var blob = new Blob(["abdefgh", "ijklmnop"]);
  var stream = blob.stream();
  const chunks = [];
  var reader = stream.getReader();
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    chunks.push(chunk.value);
  }
  expect(chunks.map((a) => a.join("")).join("")).toBe(
    Buffer.from("abdefghijklmnop").join("")
  );
});

it("ReadableStream for File", async () => {
  var blob = file(import.meta.dir + "/fetch.js.txt");
  var stream = blob.stream(24);
  const chunks = [];
  var reader = stream.getReader();
  stream = undefined;

  while (true) {
    const chunk = await reader.read();
    gc(true);
    if (chunk.done) break;
    chunks.push(chunk.value);
    gc(true);
  }
  reader = undefined;
  expect(chunks.map((a) => a.join("")).join("")).toBe(
    new Uint8Array(await blob.arrayBuffer()).join("")
  );
  gc(true);
});
