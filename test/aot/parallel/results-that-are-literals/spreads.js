function id(x) { return x; }
const one = id({ a: 1 }), two = id({ ...one, b: 2 }), three = id({ ...two, a: "over", c: 3 });
console.log(JSON.stringify([one, two, three]), three.a.length, two.c);
