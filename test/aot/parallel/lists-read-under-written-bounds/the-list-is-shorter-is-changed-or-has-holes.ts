class Holder { list: number[] = []; words: (number | undefined)[] = []; }
const holder = new Holder();
function fill(n: number, by: number): number[] { const l: number[] = []; for (let i = 0; i < n; i++) l.push(i * by); return l; }
function sum(): string { let s = 0, missing = 0; for (let i = 0; i < 16; i++) { const x = holder.list[i]; if (x === undefined) missing++; else s += x; } return s + ":" + missing; }
function cut(): number { let s = 0; for (let i = 0; i < 16; i++) s = (s + holder.list[i]!) | 0; return s; }
function shrinks(at: number): string { let s = 0, missing = 0; for (let i = 0; i < 16; i++) { if (i === at) holder.list.length = at; const x = holder.list[i]; if (x === undefined) missing++; else s += x; } return s + ":" + missing; }
function swaps(at: number, other: number[]): string { let s = 0, missing = 0; for (let i = 0; i < 16; i++) { if (i === at) holder.list = other; const x = holder.list[i]; if (x === undefined) missing++; else s += x; } return s + ":" + missing; }
function below(): string { let s = 0, missing = 0; for (let i = -2; i < 14; i++) { const x = holder.list[i]; if (x === undefined) missing++; else s += x; } return s + ":" + missing; }
function upTo(): string { let s = 0, missing = 0; for (let i = 0; i <= 16; i++) { const x = holder.list[i]; if (x === undefined) missing++; else s += x; } return s + ":" + missing; }
function byTwo(): string { let s = 0, missing = 0; for (let i = 1; i < 33; i += 2) { const x = holder.list[i]; if (x === undefined) missing++; else s += x; } return s + ":" + missing; }
for (const n of [16, 17, 15, 0, 1, 40]) { holder.list = fill(n, 3); console.log(n, sum(), cut(), below(), upTo(), byTwo()); }
holder.list = fill(16, 1.5); console.log(sum(), cut());
holder.list = fill(20, 2); delete (holder.list as (number | undefined)[])[5]; console.log(sum(), cut());
holder.list = fill(20, 2); console.log(shrinks(7), holder.list.length); holder.list = fill(20, 2); console.log(shrinks(0), shrinks(3));
holder.list = fill(20, 2); console.log(swaps(4, fill(6, 100)), swaps(1, fill(30, 1)), swaps(15, []));
holder.list = Object.freeze(fill(18, 4)) as number[]; console.log(sum(), cut());
holder.list = fill(18, 4); holder.list[100000] = 1; console.log(sum(), cut());
holder.list = fill(18, 2147483647); console.log(sum(), cut());
