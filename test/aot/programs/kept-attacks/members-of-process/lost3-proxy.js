// Members of process: lost3 proxy. It prints what plain Bun prints.
const self = new Proxy({}, { get: () => process }).anything;
self.on("message", () => {
  console.log("child got a message");
  self.exitCode = 0;
  setTimeout(() => self.exit(), 10);
});
