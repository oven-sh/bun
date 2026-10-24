// Members of process: lost3 error cause. It prints what plain Bun prints.
const self = new Error("x", { cause: process }).cause;
self.on("message", () => {
  console.log("child got a message");
  self.exitCode = 0;
  setTimeout(() => self.exit(), 10);
});
