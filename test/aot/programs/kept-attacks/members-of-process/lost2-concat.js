// Members of process: lost2 concat. It prints what plain Bun prints.
const self = [].concat(process)[0];
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
