// Built ins found by binding: programs channel child literal. It prints what plain Bun prints.
process.on("message", (message: any) => {
  console.log("child got", JSON.stringify(message), Buffer.isBuffer(message.bytes), String(message.bytes));
  process.exit(0);
});
console.log("child listens", process.listenerCount("message"), process.connected);
