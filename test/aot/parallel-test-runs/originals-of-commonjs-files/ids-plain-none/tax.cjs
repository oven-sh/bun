console.log("SAID body of tax");
exports.rate = 1;
exports.fee = () => [module.id.split("/").pop(), module.filename.split("/").pop(), __filename.split("/").pop(), __dirname === require("node:path").dirname(__filename)].join();
exports.show = () => [module.loaded, require.main === module, typeof module.parent, module.children.length, module.exports === exports].join();
exports.early = [module.loaded, module.id.split("/").pop()].join();
