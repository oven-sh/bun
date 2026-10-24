// Members of process: lost3 direct. It prints what plain Bun prints.
const self = process;
self.on("message", () => {
  console.log("child got a message");
  self.exitCode = 0;
  setTimeout(() => self.exit(), 10);
});
