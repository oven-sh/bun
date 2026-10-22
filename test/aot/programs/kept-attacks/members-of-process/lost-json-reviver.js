// Members of process: lost json reviver. It prints what plain Bun prints.
const self = JSON.parse("[0]", (key, value) => (key === "0" ? process : value))[0];
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
