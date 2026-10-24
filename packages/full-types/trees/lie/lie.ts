interface Point { x: number; y: number }
function sum(p: Point): number { return p.x + p.y; }
const lie = JSON.parse('{"x":"1","y":2}') as Point;
console.log(sum(lie));
console.log("went on");
