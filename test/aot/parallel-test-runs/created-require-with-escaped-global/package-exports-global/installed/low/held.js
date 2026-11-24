var held = null;

if (typeof global === "object" && global.Object === Object) held = global;

module.exports = held;
