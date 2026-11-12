function maybe(f?: (x: number) => number): string { return typeof f + ":" + !!f + ":" + (f ? f(2) : "none"); }
function scaled(k: number): string { return maybe(x => x * k) + " " + maybe(); }
console.log(scaled(3), scaled(4));
