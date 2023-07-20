{% callout %}
`Worker` support was added in Bun v0.6.15.
{% /callout %}

[`Worker`](https://developer.mozilla.org/en-US/docs/Web/API/Worker) lets you start and communicate with a new JavaScript instance running on a separate thread while sharing I/O resources with the main thread.

Bun implements a minimal version of the [Web Workers API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API) with extensions that make it work better for server-side use cases. Like the rest of Bun, `Worker` in Bun support CommonJS, ES Modules, TypeScript, JSX, TSX and more out of the box. No extra build steps are necessary.

## Creating a `Worker`

Like in browsers, [`Worker`](https://developer.mozilla.org/en-US/docs/Web/API/Worker) is a global. Use it to create a new worker thread.

From the main thread:

```js#Main_thread
const workerURL = new URL("worker.ts", import.meta.url).href;
const worker = new Worker(workerURL);

worker.postMessage("hello");
worker.onmessage = event => {
  console.log(event.data);
};
```

Worker thread:

```ts#worker.ts_(Worker_thread)
self.onmessage = (event: MessageEvent) => {
  console.log(event.data);
  postMessage("world");
};
```

You can use `import`/`export` syntax in your worker code. Unlike in browsers, there's no need to specify `{type: "module"}` to use ES Modules.

To simplify error handling, the initial script to load is resolved at the time `new Worker(url)` is called.

```js
const worker = new Worker("/not-found.js");
// throws an error immediately
```

The specifier passed to `Worker` is resolved relative to the project root (like typing `bun ./path/to/file.js`).

### `"open"`

The `"open"` event is emitted when a worker is created and ready to receive messages. This can be used to send an initial message to a worker once it's ready. (This event does not exist in browsers.)

```ts
const worker = new Worker(new URL("worker.ts", import.meta.url).href);

worker.addEventListener("open", () => {
  console.log("worker is ready");
});
```

Messages are automatically enqueued until the worker is ready, so there is no need to wait for the `"open"` event to send messages.

## Messages with `postMessage`

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
self.addEventListener("message", event => {
  console.log(event.data);
});
// or use the setter:
// self.onmessage = fn

// if on the main thread
worker.addEventListener("message", event => {
  console.log(event.data);
});
// or use the setter:
// worker.onmessage = fn
```

## Terminating a worker

A `Worker` instance terminate automatically when Bun's process exits. To terminate a `Worker` sooner, call `worker.terminate()`.

```ts
const worker = new Worker(new URL("worker.ts", import.meta.url).href);

// ...some time later
worker.terminate();
```

### `process.exit()`

A worker can terminate itself with `process.exit()`. This does not terminate the main process. Like in Node.js, `process.on('beforeExit', callback)` and `process.on('exit', callback)` are emitted on the worker thread (and not on the main thread).

### `"close"`

The `"close"` event is emitted when a worker has been terminated. It can take some time for the worker to actually terminate, so this event is emitted when the worker has been marked as terminated.

```ts
const worker = new Worker(new URL("worker.ts", import.meta.url).href);

worker.addEventListener("close", () => {
  console.log("worker is being closed");
});
```

This event does not exist in browsers.

## Managing lifetime

By default, an active `Worker` will _not_ keep the main (spawning) process alive. Once the main script finishes, the main thread will terminate, shutting down any workers it created.

### `worker.ref`

To keep the process alive until the `Worker` terminates, call `worker.ref()`. This couples the lifetime of the worker to the lifetime of the main process.

```ts
const worker = new Worker(new URL("worker.ts", import.meta.url).href);
worker.ref();
```

Alternatively, you can also pass an `options` object to `Worker`:

```ts
const worker = new Worker(new URL("worker.ts", import.meta.url).href, {
  ref: true,
});
```

### `worker.unref`

To stop keeping the process alive, call `worker.unref()`.

```ts
const worker = new Worker(new URL("worker.ts", import.meta.url).href);
worker.ref();
// ...later on
worker.unref();
```

Note: `worker.ref()` and `worker.unref()` do not exist in browsers.

## Memory usage with `smol`

JavaScript instances can use a lot of memory. Bun's `Worker` supports a `smol` mode that reduces memory usage, at a cost of performance. To enable `smol` mode, pass `smol: true` to the `options` object in the `Worker` constructor.

```js
const worker = new Worker("./i-am-smol.ts", {
  smol: true,
});
```

{% details summary="What does `smol` mode actually do?" %}
Setting `smol: true` sets `JSC::HeapSize` to be `Small` instead of the default `Large`.
{% /details %}
