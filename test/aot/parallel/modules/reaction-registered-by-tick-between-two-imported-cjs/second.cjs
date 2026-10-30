console.log("second runs");
Promise.resolve().then(() => console.log("job of second"));
process.nextTick(() => console.log("tick of second"));
exports.y = 1;
