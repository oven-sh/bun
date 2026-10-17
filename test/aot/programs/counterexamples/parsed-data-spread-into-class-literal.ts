// TypeScript's classes are structural: a literal with all the members of a class is of its type. So is one that takes some of them from parsed data by a spread.
class Vec { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y } len2(): number { return this.x * this.x + this.y * this.y } }
function takes(v: Vec): string { return v.x + "," + v.y + "," + v.len2() }
const real = new Vec(3, 4);
const written: Vec = { x: 3, y: 4, len2() { return -1 } };
const parsed: { x: number; y: number } = JSON.parse('{"x":6,"y":8}');
const spread: Vec = { ...parsed, len2: real.len2 };
console.log(takes(real), takes(written), takes(spread));
