// Members of process: lost3 custom event. It prints what plain Bun prints.
const self = new CustomEvent("e", { detail: process }).detail;
self.on("message", () => {
  console.log("child got a message");
  self.exitCode = 0;
  setTimeout(() => self.exit(), 10);
});
