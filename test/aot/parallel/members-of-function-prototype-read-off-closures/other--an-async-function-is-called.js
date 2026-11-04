async function f(a) { return this.k + a; }
f.call({ k: 1 }, 2).then((v) => console.log(v));
