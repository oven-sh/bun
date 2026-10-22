// Members of process: lost find. It prints what plain Bun prints.
const self = [1, process].find(x => typeof x === "object");
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
