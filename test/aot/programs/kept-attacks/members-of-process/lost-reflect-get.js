// Members of process: lost reflect get. It prints what plain Bun prints.
const self = Reflect.get(globalThis, "process");
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
