console.log("SAID body of dep");
let n = 0;
exports.next = () => ++n;
exports.box = { n: 0 };
