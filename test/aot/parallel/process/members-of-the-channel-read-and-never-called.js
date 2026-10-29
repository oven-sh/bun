// A read of process.send or process.disconnect makes a function at the most, and process.channel is an emitter: node:net, node:dgram and what passes handles and Buffers over the channel come with a call.
// STATISTIC: ImageFunctionsEmitted <= 150
console.log(typeof process.send, typeof process.disconnect, typeof process.channel, process.connected);
if (process.send) console.log("started with a channel");
