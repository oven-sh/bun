// Statements and loops at the top level that fill what a binding holds.
const log: string[] = [];
const SQUARES: number[] = [];
for (let i = 0; i < 5; i++) SQUARES.push(i * i);
const INDEX: Record<string, number> = {};
for (const [i, name] of ["a", "b", "__proto__", "c"].entries()) INDEX[name] = i;
const LOOKUP = new Map<string, number>();
for (const name of ["k", "l"]) LOOKUP.set(name, name.charCodeAt(0));
const GROWING = [1];
for (const n of GROWING) { if (n < 5) GROWING.push(n + 1); }
const PROTO: Record<string, unknown> = {};
for (const key of ["a", "__proto__"]) PROTO[key] = { marker: key };
let steps = 0;
const STEPPED: number[] = [];
for (let i = 10; i > 0; i -= 3) { STEPPED.push(i); steps++; }
const BREAKS: number[] = [];
for (let i = 0; i < 100; i++) { if (i * i > 50) break; BREAKS.push(i); }
const WHILE: number[] = [];
let w = 1; while (w < 100) { WHILE.push(w); w *= 3; }
function read(which: string) {
  switch (which) {
    case "1": return [SQUARES, INDEX, Object.keys(INDEX), [...LOOKUP]];
    case "2": return [GROWING, Object.keys(PROTO), (PROTO as any).marker, Object.getPrototypeOf(PROTO) === Object.prototype];
    default: return [STEPPED, steps, BREAKS, WHILE, w];
  }
}
for (const which of ["1", "2", "3"]) log.push(JSON.stringify(read(which)));
console.log(log.join("\n"));
