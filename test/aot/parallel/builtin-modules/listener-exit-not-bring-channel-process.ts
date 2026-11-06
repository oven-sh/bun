// Native code calls the functions of builtins/Ipc, and they load node:net, node:dgram, node:fs and the streams, for a listener of "message" or "disconnect" on `process`.
// This program spells out other events, so none of that is in its image: 1,545 functions where there were 5,915.
// STATISTIC: ImageFunctionsEmitted <= 2500
process.on("beforeExit", code => console.log("beforeExit", code));
process.once("exit", code => console.log("exit", code, process.listenerCount("exit"), process.listenerCount("beforeExit")));
console.log(process.listenerCount("exit"), process.listenerCount("beforeExit"), process.listenerCount("message"));
