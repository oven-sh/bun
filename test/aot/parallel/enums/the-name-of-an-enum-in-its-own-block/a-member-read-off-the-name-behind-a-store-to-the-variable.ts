let read: any;
// @ts-ignore
function swap() { Level = { Low: 9, Middle: 90 }; return 1; }
function same(it: number) { return it; }
function keep(it: any) { read = it; return 7; }
enum Level { Low = swap(), Middle = same(Level.Low) + 1, Upper = same(Level["Middle"]) + 1, High = keep(() => [Middle, Upper]) }
console.log(read().join());
export {};
