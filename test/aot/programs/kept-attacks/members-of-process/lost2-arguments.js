// Members of process: lost2 arguments. It prints what plain Bun prints.
const self = (function () { return arguments[0]; })(process);
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
