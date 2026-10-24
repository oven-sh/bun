// Index signatures answer by key kind; an array element is not an index signature member.
interface D { [key: string]: number }
interface N { [i: number]: string }
declare const d: D;
let n: N;
let r: Record<string, boolean>;
let t: { [k: `a${string}`]: number };
d.foo;
declare const list: number[];
list[0];
export {};
