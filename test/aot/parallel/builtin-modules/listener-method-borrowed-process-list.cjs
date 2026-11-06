// The channel belongs to `process`. On another receiver the native listener methods keep a list of listeners under `_events` and nothing else, whatever the event is called.
const borrower = {};
const heard = [];
process.on.call(borrower, "message", text => heard.push(text));
console.log(Object.keys(borrower), process.listenerCount("message"), process.listenerCount.call(borrower, "message"));
console.log(process.emit.call(borrower, "message", "one"), process.emit.call(borrower, "disconnect"), heard);
process.off.call(borrower, "message", () => {});
process.removeAllListeners.call(borrower, "message");
console.log(process.emit.call(borrower, "message", "two"), heard, process.connected, process.channel);
