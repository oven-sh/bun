const holder = { inner: null };
function keep(o) { for (let k = 0; k < 2; k++) holder.inner = o; }
function make(i) { const o = { lid: i }; keep(o); return i; }
make(3);
console.log(holder.inner.lid, JSON.stringify(holder));
