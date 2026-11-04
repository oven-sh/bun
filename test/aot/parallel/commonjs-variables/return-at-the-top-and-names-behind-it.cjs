const before = "before";
exports.read = () => { try { return before + behind; } catch (e) { return e.name; } };
console.log(exports.read());
if (before) return;
const behind = "behind";
