function counter(i) { const state = { n: i }; return { up() { return ++state.n; }, get() { return state; } }; }
function lazy(i) { const o = [i]; return () => o; }
const c = counter(1); c.up();
console.log(c.get().n, lazy(4)()[0]);
