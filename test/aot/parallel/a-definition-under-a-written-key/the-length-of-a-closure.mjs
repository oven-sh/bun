function f(a, b) {}
function act() { Object.defineProperty(f, "length", { get() { return "text"; } }); }
act();
console.log(typeof f.length, f.name);
