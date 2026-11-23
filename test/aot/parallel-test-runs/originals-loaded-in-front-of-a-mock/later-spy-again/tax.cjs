console.log("SAID body of tax");
exports.rate = 1;
setImmediate(() => { exports.late = "late"; });
exports.fee = () => exports.late;
exports.show = () => Object.keys(exports).join();
