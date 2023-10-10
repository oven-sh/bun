---
name: Spawn a child process and communicate using IPC
---

Use [`Bun.spawn()`](/docs/api/spawn) to spawn a child process and in the second object specify the ipc.

When the ipc is specified, Bun will open an IPC channel to the subprocess. The passed callback is called for incoming messages, and `subprocess.send` can send messages to the subprocess. Messages are serialized using the JSC serialize API, which allows for the same types that `postMessage`/`structuredClone` supports.


The subprocess can send and recieve messages by using `process.send` and `process.on("message")`, respectively. This is the same API as what Node.js exposes when `child_process.fork()` is used.


Currently, this is only compatible with processes that are other `bun` instances.

```ts
// index.ts
const child = Bun.spawn(["bun", "child.ts"], {
  ipc(message) {
    console.log("[Parent] Received %o", message);
  },
});

child.send("Hello from parent");
```

---

The child.ts would look like this

```ts
// child.ts

// process.send will be undefined if the ipc channel is not open
process.send("Hello from child");

process.on("message", (message) => {
  process.send(`echo: ${message}`);
});

/**
 * Output from index.ts
 * [Parent] Received Hello from child
 * [Parent] Received echo: Hello from parent
*/
```

---

The payload in the send command can even be an object

```ts
// child.ts
process.send({ message: "Hello from child" });

/**
 * Output
 * [Parent] Received {
 *  message: "Hello from child"
 * }
 * [Parent] Received echo: Hello from parent
*/
```

---

See [Docs > API > Child processes](/docs/api/spawn) for complete documentation.
