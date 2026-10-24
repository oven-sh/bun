// Members of process: lost sort. It prints what plain Bun prints.
const self = [process, process].sort(() => 0)[1];
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
