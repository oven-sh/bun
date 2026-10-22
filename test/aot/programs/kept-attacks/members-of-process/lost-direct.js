// Members of process: lost direct. It prints what plain Bun prints.
const self = process;
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
