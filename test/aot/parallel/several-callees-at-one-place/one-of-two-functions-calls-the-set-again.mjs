function f(n, depth) { return depth ? h(n + "f", depth - 1) : n; }
function g(n, depth) { return depth ? h(n + 1, depth - 1) : n; }
const h = JSON.parse("0") ? g : f;
console.log(`SAID ${h(1, 2)} ${g(1, 1)}`);
