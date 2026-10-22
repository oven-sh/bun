// Members of process: lost3 abort reason. It prints what plain Bun prints.
const self = AbortSignal.abort(process).reason;
self.on("message", () => {
  console.log("child got a message");
  self.exitCode = 0;
  setTimeout(() => self.exit(), 10);
});
