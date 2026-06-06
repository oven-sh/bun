// utilityProcess child: echoes messages back with a prefix and replies to a
// "ping" with "pong". Uses Bun's IPC (process.send / process.on('message')).
process.on("message", (msg) => {
  if (msg && msg.type === "ping") {
    process.send({ type: "pong", value: msg.value });
  } else {
    process.send({ type: "echo", value: msg });
  }
});
process.send({ type: "ready" });
