import { bench, run } from "../runner.mjs";
import React from "react";
import { renderToReadableStream } from "react-dom/server.browser";

const reactElement = React.createElement(
  "body",
  null,
  React.createElement("div", null, React.createElement("address", null, "hi")),
);

bench("ReactDOM.renderToReadableStream", async () => {
  const stream = await renderToReadableStream(reactElement);
  await stream.allReady;

  const reader = stream.getReader();
  while (true) {
    const { value, done } = await reader.read();

    if (done) {
      break;
    }
  }
});

bench("ReadableStream (3 reads)", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue("Hello");
    },
    pull(controller) {
      controller.enqueue("World");

      controller.close();
    },
  });

  const reader = stream.getReader();

  var { value, done } = await reader.read();
  ({ value, done } = await reader.read());
  ({ value, done } = await reader.read());

  if (!done) {
    throw new Error("failed");
  }
});

bench("ReadableStream (1 read -> 1 pull) x 32 * 1024  ", async () => {
  let next = Promise.withResolvers();
  let remaining = 32 * 1024;
  const stream = new ReadableStream({
    pull(controller) {
      next = Promise.withResolvers();
      controller.enqueue("Hello");
      next.resolve();
      if (remaining-- === 0) {
        controller.close();
      }
    },
  });

  const reader = stream.getReader();

  while (true) {
    var { value, done } = await reader.read();
    if (done) {
      break;
    }
    await next.promise;
  }
});
{
  let next = Promise.withResolvers();

  const stream = new ReadableStream({
    pull(controller) {
      next = Promise.withResolvers();
      next.resolve();
      controller.enqueue("Hello");
    },
  });

  const reader = stream.getReader();
  bench("ReadableStream (1 read -> 1 pull) same instance x 10 times ", async () => {
    for (let i = 0; i < 10; i++) {
      var { value, done } = await reader.read();
      await next.promise;
    }
  });
}
await run();
