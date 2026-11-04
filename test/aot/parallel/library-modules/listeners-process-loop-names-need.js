// The names of the events stand in a list that a loop goes over. None of them is a message from a parent process, so nothing of the channel to one is needed, as with a name that is written in the call.
// STATISTIC: FunctionsLowered <= 600
for (const name of ["SIGINT", "SIGTERM"]) process.on(name, () => console.log("got", name));
["SIGUSR2", "SIGHUP"].forEach(name => process.once(name, () => console.log("once", name)));
const last = ["beforeExit", "exit"];
last.forEach(name => {
  process.on(name, code => console.log(name, code));
});
for (const name of last) process.prependListener(name, () => console.log("first at", name));
console.log(["SIGINT", "SIGTERM", "SIGUSR2", "SIGHUP", "beforeExit", "exit"].map(name => process.listenerCount(name)).join());
process.emit("SIGTERM");
process.emit("SIGHUP");
process.emit("SIGHUP");
for (const name of ["SIGINT", "SIGTERM", "SIGUSR2"]) process.removeAllListeners(name);
