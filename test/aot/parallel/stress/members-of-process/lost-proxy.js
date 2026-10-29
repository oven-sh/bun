// Members of process: lost proxy. It prints what plain Bun prints.
const self = new Proxy({}, { get: () => process }).anything;
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
