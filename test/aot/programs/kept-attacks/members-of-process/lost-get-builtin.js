// Members of process: lost get builtin. It prints what plain Bun prints.
const self = process.getBuiltinModule("node:process");
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
