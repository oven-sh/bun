// Built ins found by binding: programs channel child answers. It prints what plain Bun prints.
process.on("message", (message: any) => {
  process.send!({ answer: message.ask * 2, bytes: Buffer.from("from the child") }, undefined, undefined, () => process.disconnect!());
});
process.on("disconnect", () => console.log("child is disconnected", process.connected));
