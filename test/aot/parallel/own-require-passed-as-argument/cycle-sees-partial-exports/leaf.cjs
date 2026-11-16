exports.name = "leaf";
const kit = { back: require("node:module").createRequire(__filename) };
const me = kit.back("./leaf.cjs");
exports.isMe = me === exports;
exports.seen = Object.keys(me).join("+");
