console.log("second runs");
process.nextTick(() => console.log("tick of second"));
module.exports = {};
