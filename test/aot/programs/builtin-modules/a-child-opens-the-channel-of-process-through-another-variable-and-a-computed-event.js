// The same child, written so that nothing spells it out: `process` comes through another variable and a function, the method and the event are computed. The channel is opened all the same.
const startedFromExecutable = /[$~]bun/i.test(process.argv[1]);
const listen = (emitter, method, event, listener) => emitter[method](event, listener);
if (process.env.CHILD_WITH_CHANNEL) {
  const self = [process][Number(process.env.CHILD_WITH_CHANNEL) - 1];
  const event = ["mess", "age"].join("");
  listen(self, ["o", "n"].join(""), event, message => {
    self[["se", "nd"].join("")]({ answered: message });
    if (message === "last") self.disconnect();
  });
  listen(self, "once", ["dis", "connect"].join(""), () => console.log("child: disconnect", self.connected));
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
  child.send("first");
  child.send("last");
  const [output, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  console.log(JSON.stringify(received), output.trim(), exitCode);
}
