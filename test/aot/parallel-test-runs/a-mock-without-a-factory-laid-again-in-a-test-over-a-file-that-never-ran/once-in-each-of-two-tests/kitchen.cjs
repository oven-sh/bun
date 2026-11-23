const kettle = require("./kettle.cjs");
exports.serve = () => kettle.boil() + "/" + kettle.brand;
