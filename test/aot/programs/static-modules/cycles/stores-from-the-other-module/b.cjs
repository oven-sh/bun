const a = require("./a.cjs");
a.count += 10;
a.replaced = "by b";
a.planted = "by b";
exports.read = () => [a.count, a.replaced, a.planted].join();
