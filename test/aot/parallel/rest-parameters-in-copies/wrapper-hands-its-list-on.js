function inner(a, b, c) { return (a | 0) + (b | 0) * 10 + (c | 0) * 100 + arguments.length * 1000; }
function outer(...xs) { return inner(...xs); }
function outermost(...xs) { return outer(...xs); }
function withThis(...xs) { return this.base + inner.call(null, ...xs); }
function applies(...xs) { return inner.apply(null, xs); }
let sum = 0;
for (let i = 0; i < 100; i++) sum += outer(i) + outer(i, 1) + outermost(i, 1, 2) + outermost() + withThis.call({ base: 1 }, i, 2) + applies(i, 3);
console.log(sum);
