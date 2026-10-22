// A child that was started with a channel: its listener for "message" opens the channel, process.send answers through it, process.disconnect closes it.
const startedFromExecutable = /[$~]bun/i.test(process.argv[1]);
if (process.env.CHILD_WITH_CHANNEL) {
  process.on("message", message => {
    process.send({ answered: message, connected: process.connected, hasChannel: process.channel != null });
    if (message.last) process.disconnect();
  });
  process.on("disconnect", () => console.log("child: disconnect", process.connected));
} else {
  const received = [];
  const child = Bun.spawn({
    cmd: startedFromExecutable ? [process.execPath] : [process.execPath, process.argv[1]],
    env: { ...process.env, CHILD_WITH_CHANNEL: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "inherit",
    ipc(message) { received.push(message); },
  });
  child.send({ text: "first", list: [1, 2, 3] });
  child.send({ text: "second", last: true });
  const [output, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  console.log(JSON.stringify(received));
  console.log(output.trim(), exitCode, typeof process.send, process.connected);
}
