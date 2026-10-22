// Members of process: lost reduce. It prints what plain Bun prints.
const self = [process].reduce((a, b) => b, null);
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
