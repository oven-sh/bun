// Members of process: launder symbol key. It prints what plain Bun prints.
const startedFromExecutable = /[$~]bun/i.test(process.argv[1]);
if (process.env.CHILD_WITH_CHANNEL) {
  const self = ({ [Symbol.for(process.env.CHILD_WITH_CHANNEL)]: process })[Symbol.for("1")];
  self.on("message", message => {
    self.send({ answered: message });
    self.disconnect();
  });
} else {
  const received = [];
  const child = Bun.spawn({
    cmd: startedFromExecutable ? [process.execPath] : [process.execPath, process.argv[1]],
    env: { ...process.env, CHILD_WITH_CHANNEL: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    ipc(message) { received.push(message); },
  });
  child.send("first");
  const [output, errors, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  console.log(JSON.stringify(received), output.trim(), errors.trim().split("\n").filter(line => /error/i.test(line)).join(" | "), exitCode);
}
