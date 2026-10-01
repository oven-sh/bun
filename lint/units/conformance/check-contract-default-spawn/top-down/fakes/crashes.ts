// A command that dies before it prints anything.
process.kill(process.pid, "SIGKILL");
await new Promise(() => setInterval(() => {}, 1 << 30));
