// Members of process: lost2 error cause. It prints what plain Bun prints.
const self = new Error("x", { cause: process }).cause;
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
