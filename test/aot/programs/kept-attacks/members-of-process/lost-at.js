// Members of process: lost at. It prints what plain Bun prints.
const self = [process].at(Number(process.argv.length) - 2);
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
