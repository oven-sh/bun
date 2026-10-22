// Members of process: lost2 peek. It prints what plain Bun prints.
const self = Bun.peek(Promise.resolve(process));
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
