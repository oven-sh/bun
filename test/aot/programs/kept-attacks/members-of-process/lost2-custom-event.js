// Members of process: lost2 custom event. It prints what plain Bun prints.
const self = new CustomEvent("e", { detail: process }).detail;
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
