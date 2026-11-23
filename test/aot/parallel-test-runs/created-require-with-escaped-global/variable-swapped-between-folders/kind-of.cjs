var ground;
if (typeof global === "object" && global.Object === Object) ground = global;
module.exports = value => typeof value + " " + typeof ground;
