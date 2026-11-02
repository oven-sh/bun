// Members of process: lost2 all settled. It prints what plain Bun prints.
const self = (await Promise.allSettled([process]))[0].value;
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
