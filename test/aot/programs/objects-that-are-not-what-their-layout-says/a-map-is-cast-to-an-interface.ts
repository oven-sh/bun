interface Point { x: number; y: number }
function make(): unknown { return new Map([["x", 1]]); }
const point = make() as Point;
const real: Point = { x: 1, y: 2 };
function sum(p: Point): number { return p.x + p.y; }
console.log(point.x, point.y, typeof point, sum(real));
try { console.log(sum(point)); } catch (error) { console.log("threw", (error as Error).name); }
