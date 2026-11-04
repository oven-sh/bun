class Left { name() { return "left"; } }
class Right { name() { return "right"; } }
module.exports = globalThis.process.argv.length > 99 ? Left : Right;
