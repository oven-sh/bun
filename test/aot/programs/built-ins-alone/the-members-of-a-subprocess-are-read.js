const child = Bun.spawn(["echo", "hello"]);
console.log(typeof child.pid, child.exitCode === null || child.exitCode === 0, child.ref() === undefined, child.unref() === undefined, child.connected);
console.log((await child.exited) + 1, child.exitCode + 1, child.signalCode === null, child.killed, Array.isArray(child.stdio));
const usage = child.resourceUsage();
console.log(typeof usage.maxRSS, typeof usage.cpuTime.user, typeof usage.contextSwitches.voluntary, typeof usage.ops.in, typeof usage.messages.sent, typeof usage.shmSize, typeof usage.signalCount, typeof usage.swapCount);
