// Members of process: lost2 inspect custom. It prints what plain Bun prints.
const self = (() => { let got; Bun.inspect({ [Bun.inspect.custom]() { got = process; return ""; } }); return got; })();
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
