console.log("queues runs");
setImmediate(() => console.log("immediate"));
Promise.resolve().then(() => console.log("job"));
process.nextTick(() => console.log("tick"));
module.exports = {};
