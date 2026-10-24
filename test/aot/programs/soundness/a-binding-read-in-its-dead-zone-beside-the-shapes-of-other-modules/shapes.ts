// Twenty shapes with an `x`, in a module with types.
interface WithA { x: number; a: number }
interface WithB { x: number; b: number }
interface WithC { x: number; c: number }
interface WithD { x: number; d: number }
interface WithE { x: number; e: number }
interface WithF { x: number; f: number }
interface WithG { x: number; g: number }
interface WithH { x: number; h: number }
interface WithI { x: number; i: number }
interface WithJ { x: number; j: number }
interface WithK { x: number; k: number }
interface WithL { x: number; l: number }
interface WithM { x: number; m: number }
interface WithN { x: number; n: number }
interface WithO { x: number; o: number }
interface WithP { x: number; p: number }
interface WithQ { x: number; q: number }
interface WithR { x: number; r: number }
interface WithS { x: number; s: number }
interface WithT { x: number; t: number }
const shapes: { x: number }[] = [
  { x: 1, a: 0 } as WithA,
  { x: 2, b: 0 } as WithB,
  { x: 3, c: 0 } as WithC,
  { x: 4, d: 0 } as WithD,
  { x: 5, e: 0 } as WithE,
  { x: 6, f: 0 } as WithF,
  { x: 7, g: 0 } as WithG,
  { x: 8, h: 0 } as WithH,
  { x: 9, i: 0 } as WithI,
  { x: 10, j: 0 } as WithJ,
  { x: 11, k: 0 } as WithK,
  { x: 12, l: 0 } as WithL,
  { x: 13, m: 0 } as WithM,
  { x: 14, n: 0 } as WithN,
  { x: 15, o: 0 } as WithO,
  { x: 16, p: 0 } as WithP,
  { x: 17, q: 0 } as WithQ,
  { x: 18, r: 0 } as WithR,
  { x: 19, s: 0 } as WithS,
  { x: 20, t: 0 } as WithT,
];
let sum = 0;
for (const shape of shapes) sum += shape.x;
console.log("shapes", shapes.length, sum);
export {};
