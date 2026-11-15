var freeGlobal = typeof global == "object" && global && global.Object === Object && global;

module.exports = freeGlobal;
