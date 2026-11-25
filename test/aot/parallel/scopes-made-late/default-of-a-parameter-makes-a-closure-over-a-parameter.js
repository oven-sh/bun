function f(a, get = () => a, quick) { if (quick) return get(); a++; return get() + a; }
console.log(f(1, undefined, true), f(1, undefined, false));
