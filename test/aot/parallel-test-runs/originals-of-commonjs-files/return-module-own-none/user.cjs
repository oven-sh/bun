const tax = require("./tax.cjs");
exports.used = () => [tax?.rate, typeof tax, Object.keys(tax ?? {}).sort().join("+")].join();
