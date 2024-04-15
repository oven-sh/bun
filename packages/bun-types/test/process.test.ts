process.memoryUsage();
process.cpuUsage().system;
process.cpuUsage().user;
process.on("SIGINT", () => {
  console.log("Interrupt from keyboard");
});

process.on("beforeExit", code => {
  console.log("Event loop is empty and no work is left to schedule.", code);
});

process.on("exit", code => {
  console.log("Exiting with code:", code);
});
process.kill(123, "SIGTERM");

process.getegid!();
process.geteuid!();
process.getgid!();
process.getgroups!();
process.getuid!();

process.once("SIGINT", () => {
  console.log("Interrupt from keyboard");
});

// commented methods are not yet implemented
console.log(process.allowedNodeEnvironmentFlags);
// console.log(process.channel);
// console.log(process.connected);
// console.log(process.constrainedMemory);
console.log(process.debugPort);
// console.log(process.disconnect);
// console.log(process.getActiveResourcesInfo);
// console.log(process.setActiveResourcesInfo);
// console.log(process.setuid);
// console.log(process.setgid);
// console.log(process.setegid);
// console.log(process.seteuid);
// console.log(process.setgroups);
// console.log(process.hasUncaughtExceptionCaptureCallback);
// console.log(process.initGroups);
console.log(process.listenerCount("exit"));
console.log(process.memoryUsage());
// console.log(process.report);
// console.log(process.resourceUsage);
// console.log(process.setSourceMapsEnabled());
// console.log(process.send);
process.reallyExit();
process.assert(false, "PleAsE don't Use THIs It IS dEpReCATED");
