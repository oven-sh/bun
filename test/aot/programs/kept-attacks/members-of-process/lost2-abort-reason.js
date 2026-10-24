// Members of process: lost2 abort reason. It prints what plain Bun prints.
const self = AbortSignal.abort(process).reason;
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
