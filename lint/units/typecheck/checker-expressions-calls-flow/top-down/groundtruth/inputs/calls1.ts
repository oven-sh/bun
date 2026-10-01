declare function over(x: string): number;
declare function over(x: number, y: number): string;
declare function id<T>(x: T): T;
declare function map<T, U>(a: T[], f: (x: T) => U): U[];
const a = over(true);
const b = over(1);
const c: string = id(1);
const d = map([1, 2], x => x.toFixed());
const e: number[] = d;
function tag(s: TemplateStringsArray, ...v: number[]) { return s; }
tag`a${"x"}b`;
declare const tup: [number, string];
over(...tup);
new over("a");
