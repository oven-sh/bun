// Members of process: lost array from. It prints what plain Bun prints.
const self = Array.from([process])[0];
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
