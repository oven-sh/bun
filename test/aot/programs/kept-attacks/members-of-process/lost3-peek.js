// Members of process: lost3 peek. It prints what plain Bun prints.
const self = Bun.peek(Promise.resolve(process));
self.on("message", () => {
  console.log("child got a message");
  self.exitCode = 0;
  setTimeout(() => self.exit(), 10);
});
