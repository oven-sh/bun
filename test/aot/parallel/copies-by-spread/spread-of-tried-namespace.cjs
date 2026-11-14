let tried; try { tried = require("./part-exports.mjs"); } catch (error) {}
console.log(Object.keys({ ...tried }).join());
