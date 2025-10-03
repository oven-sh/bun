---
name: Spawn a child process and communicate using IPC
---

Use [`Bun.spawn()`](https://bun.com/docs/api/spawn) to spawn a child process. When spawning a second `bun` process, you can open a direct inter-process communication (IPC) channel between the two processes.

{%callout%}
**Note** — This API is only compatible with other `bun` processes. Use `process.execPath` to get a path to the currently running `bun` executable.
{%/callout%}

```ts#parent.ts
const child = Bun.spawn(["bun", "child.ts"], {
  ipc(message) {
    /**
     * The message received from the sub process
     **/
  },
});
```

---

The parent process can send messages to the subprocess using the `.send()` method on the returned `Subprocess` instance. A reference to the sending subprocess is also available as the second argument in the `ipc` handler.

```ts#parent.ts
const childProc = Bun.spawn(["bun", "child.ts"], {
  ipc(message, childProc) {
    /**
     * The message received from the sub process
     **/
    childProc.send("Respond to child")
  },
});

childProc.send("I am your father"); // The parent can send messages to the child as well
```

---

Meanwhile the child process can send messages to its parent using with `process.send()` and receive messages with `process.on("message")`. This is the same API used for `child_process.fork()` in Node.js.

```ts#child.ts
process.send("Hello from child as string");
process.send({ message: "Hello from child as object" });

process.on("message", (message) => {
  // print message from parent
  console.log(message);
});
```

---

All messages are serialized using the JSC `serialize` API, which allows for the same set of [transferrable types](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects) supported by `postMessage` and `structuredClone`, including strings, typed arrays, streams, and objects.

```ts#child.ts
// send a string
process.send("Hello from child as string");

// send an object
process.send({ message: "Hello from child as object" });
```

---

See [Docs > API > Child processes](https://bun.com/docs/api/spawn) for complete documentation.
