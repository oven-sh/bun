// Starts net-server.js in a child process and returns the ports it listens on.
// The child is this same executable (`<app> netserver`, see scaffold.js). It is
// not traced: a client application does not run the servers it talks to.
export async function startServers() {
  const { spawn } = await import("node:child_process");
  const env = { ...process.env };
  // The tracer has already taken itself out of a traced process's environment;
  // this covers running the app by hand with the preload set.
  delete env.LD_PRELOAD;
  delete env.DYLD_INSERT_LIBRARIES;
  const child = spawn(process.execPath, ["netserver"], { stdio: ["pipe", "pipe", "inherit"], env });
  const ports = await new Promise((resolve, reject) => {
    let buffered = "";
    child.stdout.on("data", data => {
      buffered += data;
      const newline = buffered.indexOf("\n");
      if (newline >= 0) resolve(JSON.parse(buffered.slice(0, newline)));
    });
    child.on("exit", code => reject(new Error("server exited " + code)));
  });
  return {
    ...ports,
    stop() {
      child.stdin.end();
      child.kill();
    },
  };
}
