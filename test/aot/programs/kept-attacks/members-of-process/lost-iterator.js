// Members of process: lost iterator. It prints what plain Bun prints.
const self = [process].values().next().value;
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
