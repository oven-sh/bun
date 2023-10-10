---
name: Spawn a child process and communicate using IPC
---

Use [`Bun.spawn()`](/docs/api/spawn) to spawn a child process and in the second object specify the ipc

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
interface ChildProcess extends Process {
  send: (message: any) => void;
}

const send = (process as ChildProcess).send;

send("Hello from child");

process.on("message", (message) => {
  send(`echo: ${message}`);
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
send({ message: "Hello from child" });

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
