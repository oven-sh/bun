import { bench, run } from "../runner.mjs";

const CHUNK = "x".repeat(1024);
const CHUNKS = 100;

function sourceOf(n) {
  let i = 0;
  return {
    pull(c) {
      if (i++ < n) c.enqueue(CHUNK);
      else c.close();
    },
  };
}

bench("new ReadableStream()", () => {
  return new ReadableStream(sourceOf(0));
});

bench("new TransformStream()", () => {
  return new TransformStream();
});

bench("new WritableStream()", () => {
  return new WritableStream({ write() {} });
});

bench(`getReader().read() x ${CHUNKS}`, async () => {
  const reader = new ReadableStream(sourceOf(CHUNKS)).getReader();
  while (!(await reader.read()).done);
});

bench(`for await x ${CHUNKS}`, async () => {
  let n = 0;
  for await (const chunk of new ReadableStream(sourceOf(CHUNKS))) n += chunk.length;
  return n;
});

bench(`pipeTo x ${CHUNKS}`, async () => {
  let n = 0;
  await new ReadableStream(sourceOf(CHUNKS)).pipeTo(
    new WritableStream({
      write(c) {
        n += c.length;
      },
    }),
  );
  return n;
});

bench(`pipeThrough(TransformStream) + drain x ${CHUNKS}`, async () => {
  const rs = new ReadableStream(sourceOf(CHUNKS)).pipeThrough(new TransformStream());
  const reader = rs.getReader();
  while (!(await reader.read()).done);
});

bench(`tee + drain both x ${CHUNKS}`, async () => {
  const [a, b] = new ReadableStream(sourceOf(CHUNKS)).tee();
  const drain = async s => {
    const r = s.getReader();
    while (!(await r.read()).done);
  };
  await Promise.all([drain(a), drain(b)]);
});

bench(`new Response(stream).text() x ${CHUNKS}`, async () => {
  return (await new Response(new ReadableStream(sourceOf(CHUNKS))).text()).length;
});

bench(`writer.write() x ${CHUNKS}`, async () => {
  const ws = new WritableStream({ write() {} });
  const writer = ws.getWriter();
  for (let i = 0; i < CHUNKS; i++) await writer.write(CHUNK);
  await writer.close();
});

bench(`byte stream BYOB read x ${CHUNKS}`, async () => {
  let i = 0;
  const rs = new ReadableStream({
    type: "bytes",
    autoAllocateChunkSize: 1024,
    pull(c) {
      if (i++ < CHUNKS) {
        const view = c.byobRequest.view;
        new Uint8Array(view.buffer, view.byteOffset, view.byteLength).fill(7);
        c.byobRequest.respond(view.byteLength);
      } else {
        c.close();
        // An outstanding BYOB request must be released after close().
        c.byobRequest?.respond(0);
      }
    },
  });
  const reader = rs.getReader({ mode: "byob" });
  let n = 0;
  while (true) {
    const { done, value } = await reader.read(new Uint8Array(1024));
    if (done) break;
    n += value.byteLength;
  }
  return n;
});

if (typeof Bun !== "undefined") {
  bench(`Bun.readableStreamToText x ${CHUNKS}`, async () => {
    return (await Bun.readableStreamToText(new ReadableStream(sourceOf(CHUNKS)))).length;
  });
  bench(`Bun.readableStreamToArray x ${CHUNKS}`, async () => {
    return (await Bun.readableStreamToArray(new ReadableStream(sourceOf(CHUNKS)))).length;
  });
}

await run();
