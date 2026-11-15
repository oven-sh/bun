// STATISTIC: SuperCallsDevirtualized >= 1
// half a million calls deep another function is laid above: from there on the call through super goes as it is written, and it leaves no frame either
const words = JSON.parse('{"walk":"walk"}');
class Path { walk(left, seen) { if (!left) return "first " + seen; if (left === 500000) Path.prototype[words.walk] = later; return this.walk(left - 1, seen + 1); } }
class Trail extends Path { walk(left, seen) { return super.walk(left, seen); } }
function later(left, seen) { if (!left) return "later " + seen; return this.walk(left - 1, seen + 2); }
console.log(new Trail().walk(3, 0));
console.log(new Trail().walk(1000000, 0));
console.log(new Trail().walk(1000000, 0));
