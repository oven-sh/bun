// Members of process: lost2 group by. It prints what plain Bun prints.
const self = Object.groupBy([process], () => "p").p[0];
self.on("message", message => {
  console.log("child got", JSON.stringify(message));
  setTimeout(() => self.exit(0), 10);
});
