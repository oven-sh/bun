// Members of process: lost3 error event. It prints what plain Bun prints.
const self = new ErrorEvent("e", { error: process }).error;
self.on("message", () => {
  console.log("child got a message");
  self.exitCode = 0;
  setTimeout(() => self.exit(), 10);
});
