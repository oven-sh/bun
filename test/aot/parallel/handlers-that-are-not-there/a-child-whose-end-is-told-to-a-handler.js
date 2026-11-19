// The one handler that is there is handed the child, its exit code, no signal and no error: the row says so, and what the other handlers would be handed counts for nothing.
Bun.spawn(["true"], {
  stdin: "ignore",
  stdout: "ignore",
  stderr: "ignore",
  onExit(child, code, signal, error) {
    console.log(typeof child.pid, code, signal, error);
  },
});
