// Members of interfaces and type literals are written; members of an object literal are not.
interface Point { x: number; y: string; move(dx: number): void }
declare const p: Point;
p.x;
p["y"];
let q: { a: boolean };
const o = { a: 1 };
o.a;
export {};
