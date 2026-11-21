// One closure with a property stands in the place of Math.random: it is called in loops, as a value and under another name, and what stood there is put back at the end.
const standing = Math.random;
function seeded(seed) { let state = seed; const next = () => { next.calls++; state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; }; next.calls = 0; return next; }
const first = seeded(7);
Math.random = first;
function mean(n) { let sum = 0; for (let i = 0; i < n; i++) sum += Math.random(); return n ? sum / n : -1; }
function picked(list, n) { let out = ""; for (let i = 0; i < n; i++) out += list[Math.floor(Math.random() * list.length)]; return out; }
function mixed(list) { const out = list.slice(); for (let i = out.length - 1; i > 0; i--) { const other = (Math.random() * (i + 1)) | 0, held = out[i]; out[i] = out[other]; out[other] = held; } return out.join(); }
const under = Math.random, { random } = Math, bound = Math.random.bind(null);
function byValue(n, f) { let sum = 0; for (let i = 0; i < n; i++) sum += f() < 0.5 ? 1 : 0; return sum; }
console.log(mean(0), mean(10).toFixed(9), picked("abcdef", 12), mixed([1, 2, 3, 4, 5, 6, 7]), first.calls);
console.log(byValue(20, Math.random), byValue(20, under), byValue(20, random), byValue(20, bound), byValue(20, () => Math.random()), first.calls, under === first, Math.random.name, Math.random.length, Object.keys(Math.random).join());
console.log([1, 2, 3].map(Math.random).map(v => v.toFixed(6)).join(), Array.from({ length: 3 }, Math.random).map(v => v.toFixed(6)).join(), first.calls);
const second = seeded(99); Math.random = second; console.log(mean(5).toFixed(9), byValue(8, under), first.calls, second.calls); delete second.calls; console.log(mean(2).toFixed(6), String(second.calls));
Math.random = 5; try { mean(1); } catch (error) { console.log(error.constructor.name); } Math.random = undefined; try { picked("ab", 1); } catch (error) { console.log(error.constructor.name); }
Math.random = function () { return this === Math ? 0.25 : 0.75; }; console.log(mean(4), byValue(4, Math.random), picked("wxyz", 3)); Math.random = () => NaN; console.log(mean(2), picked("ab", 2), mixed([1, 2]));
let asked = 0; Object.defineProperty(Math, "random", { configurable: true, get() { asked++; return () => asked / 100; } }); console.log(mean(3).toFixed(6), asked); Object.defineProperty(Math, "random", { configurable: true, writable: true, enumerable: false, value: standing });
let inside = true; for (let i = 0; i < 500; i++) { const v = Math.random(); if (!(v >= 0 && v < 1)) inside = false; } console.log(inside, Math.random === standing, first.calls);
