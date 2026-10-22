// Members of process: lost promise. It prints what plain Bun prints.
const self = await Promise.resolve(process);
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
