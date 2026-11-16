const kettle = require("./kettle.cjs");
globalThis.kitchens = (globalThis.kitchens ?? 0) + 1;
exports.kettle = kettle;
