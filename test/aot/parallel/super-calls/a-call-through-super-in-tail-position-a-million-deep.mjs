// STATISTIC: SuperCallsDevirtualized >= 2
// a method hands on to the method above by `return super.walk(..)`, which calls the method below again: a million calls deep the stack is as it was
const words = JSON.parse('{"walk":"walk","none":""}');
class Path { walk(left, seen) { if (!left) return seen; return this.walk(left - 1, seen + 1); } }
class Trail extends Path { walk(left, seen) { return super.walk(left, seen); } }
class Track extends Trail { walk(left, seen) { return super.walk(left, seen); } }
if (words.none) Path.prototype[words.walk] = null;
console.log(new Trail().walk(3, 0), new Track().walk(3, 0));
console.log(new Trail().walk(1000000, 0), new Track().walk(1000000, 0));
