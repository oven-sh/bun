// Members of process: lost microtask. It prints what plain Bun prints.
const self = await new Promise(resolve => queueMicrotask(() => resolve(process)));
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
