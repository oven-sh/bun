// Assorted, one probe of many. It prints what plain Bun prints.
process.stdout.once("finish", () => {});
console.log(process.stdout.listenerCount("finish"));
