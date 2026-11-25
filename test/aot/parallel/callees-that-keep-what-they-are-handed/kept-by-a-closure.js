let later = null;
function keep(o) { for (let k = 0; k < 2; k++) later = () => o.lid; }
function make(i) { const o = { lid: i }; keep(o); return i; }
make(5);
console.log(later());
