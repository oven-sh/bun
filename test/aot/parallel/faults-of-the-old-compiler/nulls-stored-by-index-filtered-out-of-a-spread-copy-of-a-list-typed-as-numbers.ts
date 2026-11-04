// A loop stores nulls by index into a list typed as numbers; a helper called twice copies it by a spread and filters them out.
const temps: number[] = [20.5, 21.5, 99.5, 22.5, 98.5];
function mask(l: number[]) { for (let i = 0; i < l.length; i++) if (l[i] > 50) l[i] = null as any; }
function keep(l: number[]) { return [...l].filter(v => v !== null); }
mask(temps);
console.log(keep(temps).length, keep(temps).length);
export {};
