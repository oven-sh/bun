// Members of process: lost2 with resolvers. It prints what plain Bun prints.
const self = (() => { const { promise, resolve } = Promise.withResolvers(); resolve(process); return promise; })().then(p => p) && await Promise.resolve(process);
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
