// Members of process: lost weakmap. It prints what plain Bun prints.
const self = (() => { const k = {}; return new WeakMap([[k, process]]).get(k); })();
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
