// Built ins found by binding: programs channel child variable. It prints what plain Bun prints.
const p = process;
const name = ["mess", "age"].join("");
p.on(name, (message: any) => {
  console.log("child got", JSON.stringify(message), Buffer.isBuffer(message.bytes), String(message.bytes));
  p.exit(0);
});
console.log("child listens", p.listenerCount(name), p.connected);
