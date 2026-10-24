// Members of process: lost2 iterator from. It prints what plain Bun prints.
const self = Iterator.from([process]).toArray()[0];
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
