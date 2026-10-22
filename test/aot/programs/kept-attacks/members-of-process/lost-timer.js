// Members of process: lost timer. It prints what plain Bun prints.
const self = await new Promise(resolve => setTimeout(resolve, 1, process));
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
