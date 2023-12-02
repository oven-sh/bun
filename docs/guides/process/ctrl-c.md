---
name: Listen for CTRL+C
---

The `ctrl+c` shortcut sends an _interrupt signal_ to the running process. This signal can be intercepted by listening for the `SIGINT` event. If you want to close the process, you must explicitly call `process.exit()`.

```ts
process.on("SIGINT", () => {
  console.log("Ctrl-C was pressed");
  process.exit();
});
```

---

See [Docs > API > Utils](/docs/api/utils) for more useful utilities.
