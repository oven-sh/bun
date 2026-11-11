const k = [];
function f(o) { if (!o.a) return; k.push({ ...o }); }
f({ a: 1 }); f({ a: "x", b: 3 }); console.log(k.length, JSON.stringify(k));
