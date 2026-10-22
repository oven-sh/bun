// Members of process: lost2 url pattern. It prints what plain Bun prints.
const self = new Headers().constructor === Headers ? AbortSignal.any([AbortSignal.abort(process)]).reason : null;
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
