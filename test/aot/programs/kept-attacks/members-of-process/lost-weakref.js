// Members of process: lost weakref. It prints what plain Bun prints.
const self = new WeakRef(process).deref();
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
