// Members of process: lost emitter this. It prints what plain Bun prints.
const self = (() => { let found; process.once("warning", function () { found = this; }); process.emit("warning", {}); return found; })();
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
