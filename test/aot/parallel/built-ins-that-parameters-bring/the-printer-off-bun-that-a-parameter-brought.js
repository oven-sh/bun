function g(o) { return o.Bun; } function h(o) { return o.inspect; } console.log(h(g(globalThis))({ a: [1, { b: 2 }] }));
