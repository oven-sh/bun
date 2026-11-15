const unseen = (x: any): any => [x][JSON.parse("0")];
function twice(value: any, first: boolean, second: boolean): number { if (value && first) return 1; if (value && second) return 2; return 3; }
const values: any[] = [undefined, null, false, true, 0, -0, NaN, 1, 0.5, "", "text", 0n, 7n, Symbol.iterator, {}, [], () => 0, new Map()];
const said: number[] = [];
for (const value of values) for (const first of [false, true]) for (const second of [false, true]) said.push(Reflect.apply(twice, undefined, [unseen(value), first, second]));
console.log(said.join(""));
