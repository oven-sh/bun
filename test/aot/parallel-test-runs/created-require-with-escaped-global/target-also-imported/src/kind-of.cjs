var freeGlobal = typeof global == "object" && global && global.Object === Object && global;
module.exports = value => typeof value + " " + typeof freeGlobal;
