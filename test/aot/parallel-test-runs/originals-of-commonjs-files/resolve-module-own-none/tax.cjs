console.log("SAID body of tax");
exports.rate = 1;
exports.fee = () => require.resolve("./dep.cjs").split("/").pop();
exports.show = () => Object.keys(require.cache).map(it => it.split("/").pop()).filter(it => /tax|dep/.test(it)).sort().join();
