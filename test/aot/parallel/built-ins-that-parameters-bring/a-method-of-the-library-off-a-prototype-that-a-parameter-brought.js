function g(o) { return o.prototype; } function h(o) { return o.flatMap; } console.log(h(g(Array)).call([1, 2], x => [x, x]).join());
