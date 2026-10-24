// Members of process: lost2 next tick. It prints what plain Bun prints.
const self = await new Promise(resolve => process.nextTick(resolve, process));
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
