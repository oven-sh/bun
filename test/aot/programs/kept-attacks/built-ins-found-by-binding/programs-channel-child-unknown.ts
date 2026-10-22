// Built ins found by binding: programs channel child unknown. It prints what plain Bun prints.
const p = (globalThis as any)[["pro", "cess"].join("")];
p.on("message", (message: any) => {
  console.log("child got", JSON.stringify(message), Buffer.isBuffer(message.bytes), String(message.bytes));
  p.exit(0);
});
console.log("child listens", p.listenerCount("message"), p.connected);
