const kit = { load: require("node:module").createRequire(__filename) };
const leaf = kit.load("./leaf.cjs");
exports.saw = Object.keys(leaf).join("+");
exports.leaf = () => leaf.last;
