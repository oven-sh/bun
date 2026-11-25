const state = require("./state.cjs");
exports.sum = function (start) { let total = start; for (let place = 0; place < state.shelf.rows.length; place++) total = total + state.shelf.rows[place]; return total; };
