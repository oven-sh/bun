// Members of process: lost als. It prints what plain Bun prints.
const self = (() => { const { AsyncLocalStorage } = require("node:async_hooks"); const s = new AsyncLocalStorage(); return s.run(process, () => s.getStore()); })();
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
