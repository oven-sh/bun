// a value that is not what its type says comes to two accesses in a row: null and undefined throw at the first, a literal and a number go through both as they are written
class Point { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } }
function subject(o: Point) { const x = o.x; const y = o.y; return x + "," + y; }
function deed(o: unknown) { try { return subject(o as Point); } catch (e) { return (e as Error).name; } }
console.log(deed(new Point(1, 2)));
let text = "";
for (let i = 0; i < 300; i++) text = deed(new Point(i, i + 1));
console.log(text);
console.log(deed(null), deed(undefined), deed({ y: 4, x: 3 }), deed(5), deed("ab"), deed(Object.create(Point.prototype)));
console.log(deed(new Point(8, 9)));
