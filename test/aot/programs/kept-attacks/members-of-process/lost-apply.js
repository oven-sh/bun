// Members of process: lost apply. It prints what plain Bun prints.
const self = Reflect.apply(x => x, undefined, [process]);
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
