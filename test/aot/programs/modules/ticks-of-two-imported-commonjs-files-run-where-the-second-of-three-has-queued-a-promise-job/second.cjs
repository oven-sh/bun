console.log("second runs");
process.nextTick(() => console.log("tick of second"));
Promise.resolve().then(() => console.log("job of second"));
