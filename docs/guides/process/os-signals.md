---
name: Listen to OS signals
---

Bun supports the Node.js `process` global, including the `process.on()` method for listening to OS signals.

```ts
process.on("SIGINT", () => {
  console.log("Received SIGINT");
});
```

---

If you don't know which signal to listen for, you listen to the umbrella `"exit"` event.

```ts
process.on("exit", code => {
  console.log(`Process exited with code ${code}`);
});
```

---

If you don't know which signal to listen for, you listen to the [`"beforeExit"`](https://nodejs.org/api/process.html#event-beforeexit) and [`"exit"`](https://nodejs.org/api/process.html#event-exit) events.

```ts
process.on("beforeExit", code => {
  console.log(`Event loop is empty!`);
});

process.on("exit", code => {
  console.log(`Process is exiting with code ${code}`);
});
```

---

See [Docs > API > Utils](https://bun.sh/docs/api/utils) for more useful utilities.
