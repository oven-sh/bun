const m = new Map([["a", 1]]);
function f(k) { return m.get(...[k]);
} console.log(f("a"), f("z"), [..."ab"].map(f).join());
export {};
