[`Worker`](https://developer.mozilla.org/en-US/docs/Web/API/Worker) lets you start and communicate with a new JavaScript instance running on a separate thread while sharing I/O resources with the main thread. You can use TypeScript, CommonJS, ESM, JSX, etc in your workers. `Worker` support was added in Bun v0.6.15.

Bun implements a minimal version of the [Web Workers API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API) with extensions that make it work better for server-side use cases.

## Usage

Like in browsers, [`Worker`](https://developer.mozilla.org/en-US/docs/Web/API/Worker) is a global. Use it to create a new worker thread.

Main thread:

```js
const worker = new Worker(new URL("worker.ts", import.meta.url).href);
worker.postMessage("hello");
worker.onmessage = event => {
  console.log(event.data);
};
```

Worker thread:

{% codetabs %}

```ts#worker.ts
self.onmessage = (event: MessageEvent) => {
  console.log(event.data);
  postMessage("world");
};
```

{% /codetabs %}

### Sending & receiving messages with `postMessage`

To send messages, use [`worker.postMessage`](https://developer.mozilla.org/en-US/docs/Web/API/Worker/postMessage) and [`self.postMessage`](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage). This leverages the [HTML Structured Clone Algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm).

```js
// On the worker thread, `postMessage` is automatically "routed" to the parent thread.
postMessage({ hello: "world" });

// On the main thread
worker.postMessage({ hello: "world" });
```

To receive messages, use the [`message` event handler](https://developer.mozilla.org/en-US/docs/Web/API/Worker/message_event) on the worker and main thread.

```js
// Worker thread:
self.addEventListener("message", = event => {
  console.log(event.data);
});
// or use the setter:
// self.onmessage = fn

// if on the main thread
worker.addEventListener("message", = event => {
  console.log(event.data);
});
// or use the setter:
// worker.onmessage = fn
```

### Terminating a worker

A `Worker` instance terminate automatically when Bun's process exits. To terminate a `Worker` sooner, call `worker.terminate()`.

```ts
const worker = new Worker(new URL("worker.ts", import.meta.url).href);

// ...some time later
worker.terminate();
```

### Managing lifetime with `worker.ref` and `worker.unref`

By default, a `Worker` will **not** keep the process alive. To keep the process alive until the `Worker` terminates, call `worker.ref()`.

```ts
const worker = new Worker(new URL("worker.ts", import.meta.url).href);
worker.ref();
```

You can also pass an `options` object to `Worker`:

```ts
const worker = new Worker(new URL("worker.ts", import.meta.url).href, {
  bun: {
    ref: true,
  },
});
```

To stop keeping the process alive, call `worker.unref()`.

```ts
const worker = new Worker(new URL("worker.ts", import.meta.url).href);
worker.ref();
// ...later on
worker.unref();
```

Note: `worker.ref()` and `worker.unref()` do not exist in browsers.

### Memory Usage

JavaScript instances sometimes use a lot of memory.

Bun's `Worker` supports a `smol` mode that reduces memory usage, at a cost of performance. To enable `smol` mode, pass `smol: true` to the `options` object in the `Worker` constructor.

```js
const worker = new Worker("./i-am-smol.ts", {
  bun: {
    smol: true,
  },
});
```

#### What does `smol` mode actually do?

It sets ` JSC::HeapSize` to be `Small` instead of the default `Large`

### Worker supports ES Modules, CommonJS, TypeScript, JSX, etc

Like the rest of Bun, `Worker` in Bun support CommonJS, ES Modules, TypeScript, JSX, TSX and more out of the box. No extra build steps are necessary. You can use `import` and `export` in your worker code. This is different than browsers, where `"type": "module"` is necessary to use ES Modules.

To simplify error handling, the initial script to load is resolved at the time `new Worker(url)` is called.

```js
const worker = new Worker("/not-found.js");
// throws an error immediately
```

The specifier passed to `Worker` is resolved relative to the project root (like typing `bun ./path/to/file.js`).

### `"open"` event

The `"open"` event is emitted when a worker is created and ready to receive messages.

```ts
const worker = new Worker(new URL("worker.ts", import.meta.url).href);
worker.addEventListener("open", () => {
  console.log("worker is ready");
});
```

This event does not exist in browsers.

### `"close"` event

The `"close"` event is emitted when a worker has been terminated. It can take some time for the worker to actually terminate, so this event is emitted when the worker has been marked as terminated.

```ts
const worker = new Worker(new URL("worker.ts", import.meta.url).href);
worker.addEventListener("close", () => {
  console.log("worker is ready");
});
```

This event does not exist in browsers.

### `process.exit()` inside a worker

Calling `process.exit()` in a Worker terminates the worker, but does not terminate the main process. Like in Node.js, `process.on('beforeExit', callback)` and `process.on('exit', callback)` are emitted on the worker thread (and not on the main thread).
