exports.name = "second";
exports.list = ["a", { b: ["c"] }];
exports.self = () => typeof module.exports.self + ":" + typeof module.id;
