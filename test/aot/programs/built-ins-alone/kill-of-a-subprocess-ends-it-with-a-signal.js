const child = Bun.spawn(["sleep", "10"]);
console.log(child.kill() === undefined);
await child.exited;
console.log(child.signalCode, child.killed, child.exitCode === null);
