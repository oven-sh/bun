// `Function.prototype.call.bind(f)`, Node's `uncurryThis`, is called without going through the runtime.
declare const console: any;
function add(this: { k: number }, x: number): number { return this.k + x; }
const uncurryThis = (f: Function): any => Function.prototype.call.bind(f);
const addTo: (o: { k: number }, x: number) => number = uncurryThis(add);
const sliceOf: (s: string, a: number, b: number) => string = uncurryThis(String.prototype.slice);
const o = { k: 1 };
console.log(addTo(o, 2), sliceOf("abcdef", 1, 3));
let t = 0;
for (let i = 0; i < 5000000; i++) t = (t + addTo(o, i & 7) + sliceOf("abcdef", i & 3, 5).length) | 0;
console.log(t);
export {};
