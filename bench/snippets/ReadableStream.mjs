import { bench, run } from "../runner.mjs";

bench("new ReadableStream({})", () => {
  return new ReadableStream({});
});

const buffer = new Uint8Array(1);

bench("new ReadableStream() x 1 byte", () => {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(buffer);
      controller.close();
    },
  });
});

bench("new ReadableStream(), enqueue 1024 x 1 byte, read 1024 x 1 byte", async () => {
  const stream = new ReadableStream({
    pull(controller) {
      for (let i = 0; i < 1024; i++) {
        controller.enqueue(buffer);
      }
      controller.close();
    },
  });

  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
  }
});

bench("new ReadableStream(), (enqueue 1 byte, read 1 byte) x 1024", async () => {
  let resume = Promise.withResolvers();
  let promise = Promise.withResolvers();
  const stream = new ReadableStream({
    cancel(reason) {},
    async pull(controller) {
      for (let i = 0; i < 1024; i++) {
        controller.enqueue(buffer);
        await resume.promise;
        resume = Promise.withResolvers();
      }
      controller.close();
      promise.resolve();
    },
  });

  const reader = stream.getReader();
  async function run() {
    while (true) {
      const { done, value } = await reader.read();
      resume.resolve();
      if (done) break;
    }
  }
  await run();
  await promise.promise;
});

await run();
