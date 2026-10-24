// Members of process: lost2 error event. It prints what plain Bun prints.
const self = new ErrorEvent("e", { error: process }).error;
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
