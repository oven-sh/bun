const l = [1, 2];
let ran = 0;
function act() { Object.defineProperty(l, "0", { get() { ran++; return "text"; } }); }
act();
function first(h) { let f; for (let i = 0; i < 1; i++) f = h[i]; return f; }
console.log(typeof first(l), typeof l[1], ran, l.length);
