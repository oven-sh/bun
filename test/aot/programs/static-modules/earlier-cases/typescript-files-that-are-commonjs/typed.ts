declare const module: { exports: unknown };
interface Point { x: number; y: number }
function make(x: number): Point { return { x, y: 2 }; }
module.exports = { make };
