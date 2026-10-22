// Members of process: lost2 construct return. It prints what plain Bun prints.
const self = new (class { constructor() { return process; } })();
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
