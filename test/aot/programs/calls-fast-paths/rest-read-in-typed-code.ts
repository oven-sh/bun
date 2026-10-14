// A typed function reads its rest array under an integer: the argument is loaded where it is: no array, no boxed key, no slow path, and nothing is summed up for the read.
// IR= 0 defined CreateRest
// IR= 1 defined GetMyArgumentByVal
// IR= 1 defined GetRestLength
// IR= 0 last CreateRest
declare const console: any;
function defined(...values: unknown[]): number { let n = 0; for (let i = 0; i < values.length; i++) if (values[i] !== undefined) n++; return n; }
function last(...values: unknown[]): unknown { return values[values.length - 1]; }
const table: any[] = [defined, last];
let n = 0;
for (let i = 0; i < 3_000_000; i++) n += table[0](i, undefined, "s", 4) + table[1](1, 2, i & 1);
console.log(n);
export {};
