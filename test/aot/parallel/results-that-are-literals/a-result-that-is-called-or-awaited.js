function id(x) { return x; }
const f = id(() => 5), o = id({ then: undefined, v: 1 }), p = id(Promise.resolve({ w: 2 }));
console.log(f(), o.v, typeof p.then);
p.then(r => console.log(r.w, r.v));
