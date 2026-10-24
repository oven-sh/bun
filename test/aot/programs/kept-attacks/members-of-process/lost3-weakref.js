// Members of process: lost3 weakref. It prints what plain Bun prints.
const self = new WeakRef(process).deref();
self.on("message", () => {
  console.log("child got a message");
  self.exitCode = 0;
  setTimeout(() => self.exit(), 10);
});
