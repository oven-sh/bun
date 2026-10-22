// Members of process: lost2 suppressed. It prints what plain Bun prints.
const self = new SuppressedError(process, null).error;
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
