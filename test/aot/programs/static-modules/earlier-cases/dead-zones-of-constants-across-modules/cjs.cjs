function probe(f) { try { return String(f()); } catch (e) { return e.constructor.name; } }
function hoisted() { return LIMIT * 2; }
exports.before = probe(hoisted);
const LIMIT = 21;
exports.after = probe(hoisted);
