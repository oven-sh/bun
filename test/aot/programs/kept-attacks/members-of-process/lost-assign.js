// Members of process: lost assign. It prints what plain Bun prints.
const self = Object.assign({}, { p: process }).p;
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
