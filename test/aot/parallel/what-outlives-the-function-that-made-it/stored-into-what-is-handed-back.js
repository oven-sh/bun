function make(i) { const inner = { v: i }; const list = [inner, { v: i + 1 }]; const outer = { inner, list }; return outer; }
function later(i) { const inner = { v: i }; const outer = { inner: null }; outer.inner = inner; return outer; }
const a = make(1), b = later(5);
console.log(a.inner.v, a.list[1].v, a.list[0] === a.inner, b.inner.v);
