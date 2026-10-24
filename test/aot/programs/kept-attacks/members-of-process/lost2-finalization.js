// Members of process: lost2 finalization. It prints what plain Bun prints.
const self = (() => { const holder = []; holder.push(process); return holder.pop(); })();
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
