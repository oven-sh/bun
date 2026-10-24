// Members of process: lost flat. It prints what plain Bun prints.
const self = [[process]].flat()[0];
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
