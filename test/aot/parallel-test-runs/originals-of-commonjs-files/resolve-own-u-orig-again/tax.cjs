console.log("SAID body of tax");
exports.rate = 1;
exports.fee = () => require.resolve(__filename).split("/").pop();
exports.show = () => typeof require.cache[__filename];
