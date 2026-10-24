// Members of process: lost from entries. It prints what plain Bun prints.
const self = Object.fromEntries([["p", process]]).p;
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
