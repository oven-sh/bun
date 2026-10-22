// Members of process: lost computed global. It prints what plain Bun prints.
const self = globalThis[["pro", "cess"].join("")];
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
