const part = require("./part.cjs");
const t = part.late;
exports.seen = (t === undefined ? "missing" : t + 1) + "," + (part.early + 1);
