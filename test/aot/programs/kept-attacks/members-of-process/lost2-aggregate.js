// Members of process: lost2 aggregate. It prints what plain Bun prints.
const self = new AggregateError([process]).errors[0];
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
