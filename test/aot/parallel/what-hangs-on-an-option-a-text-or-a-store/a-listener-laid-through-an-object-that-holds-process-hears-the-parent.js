if (process.argv.length > 2) {
  const holder = { _events: process };
  process.on.call(holder, "message", message => { console.log("heard", String(message.bytes)); process.exit(0); });
} else {
  const again = JSON.stringify([process.execPath, process.argv[1], "child"]);
  const text = `const c = Bun.spawn(${again}, { env: {}, stdout: "inherit", stderr: "inherit", [["ip", "c"].join("")]() {} }); c.send({ bytes: Buffer.from("x") }); await c.exited;`;
  const middle = Bun.spawn([process.execPath, "-e", text], { env: { BUN_BE_BUN: "1" }, stdout: "inherit", stderr: "inherit" });
  await middle.exited;
}
