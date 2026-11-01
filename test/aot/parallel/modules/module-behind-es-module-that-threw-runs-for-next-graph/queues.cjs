console.log("queues.cjs runs");
exports.v = 1;
Promise.resolve().then(() => console.log("job of queues.cjs"));
