// STATISTIC: SuperCallsDevirtualized >= 1
// the call through super is the whole body of an arrow that the method calls last
const words = JSON.parse('{"walk":"walk","none":""}');
class Path { walk(left, on) { if (!left) return "home"; return on(left - 1, on); } }
class Trail extends Path { walk(left, on) { const above = () => super.walk(left, on); return above(); } }
if (words.none) Path.prototype[words.walk] = null;
const trail = new Trail();
function on(left, again) { return trail.walk(left, again); }
console.log(trail.walk(3, on));
console.log(trail.walk(1000000, on));
