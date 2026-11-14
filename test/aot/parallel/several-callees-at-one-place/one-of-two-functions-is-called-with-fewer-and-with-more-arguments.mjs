function f(n, m) { return `${n}${m}${arguments.length}`; }
function g(n, ...rest) { return `${n}${rest.length}`; }
const h = JSON.parse("0") ? g : f;
function warm() { let t = ""; for (let i = 0; i < 3; i++) t = h(i, i); return t; }
console.log(`SAID ${warm()} ${h()} ${h(1, 2, "x")} ${h(...["a"])}`);
