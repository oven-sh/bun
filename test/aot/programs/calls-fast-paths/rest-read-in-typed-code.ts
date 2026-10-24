// A typed function reads its rest parameter by an integer index: no array, no boxing, no slow path.
// Both functions are called out of a table that is never stored to, so both calls are taken into the module's own code and no body of theirs is left.
// IRM= 0 CreateRest
// IR= 1 defined GetMyArgumentByVal
// IR= 1 defined GetRestLength
declare const console: any;
function defined(...values: unknown[]): number { let n = 0; for (let i = 0; i < values.length; i++) if (values[i] !== undefined) n++; return n; }
function last(...values: unknown[]): unknown { return values[values.length - 1]; }
const table: any[] = [defined, last];
let n = 0;
for (let i = 0; i < 3_000_000; i++) n += table[0](i, undefined, "s", 4) + table[1](1, 2, i & 1);
console.log(n);
export {};
