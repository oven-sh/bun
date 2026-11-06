require("./grandchild.cjs");
const unknown = value => new CustomEvent("unknown", { detail: value }).detail;
const m = unknown(module);
exports.seen = [typeof m.exports, String(m.children?.length), typeof m.parent].join(" ");
