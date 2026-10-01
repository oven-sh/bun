declare let b: { x: string };
declare let c: { x: number };
c = b;
interface A { x: number; y: { z: string } }
const a: A = { x: 1, y: { z: 2 } };
declare let f: (p: string) => { q: number };
declare let g: (p: string) => { q: string };
f = g;
