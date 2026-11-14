var view = new Int32Array(16), doubles = new Float64Array(4), scale = 3, texts = [], later = null;
function add(a, b) { return (a + b) | 0; }
function step(i, n) { view[i & 15] = add(n, i * scale); doubles[i & 3] = n / 2; return add(view[(i * 5) & 15], doubles[i & 1] | 0); }
function loop(k, n) { for (var i = 0; i < k; i++) { view[i & 15] = n; n = add(n, view[(i + 1) & 15]) & 0xffff; } return n; }
function evaluate(text) { return eval(text); }
function run(k) { var n = 0; for (var i = 0; i < k; i++) { try { n = step(i, n) & 0xffff; n = loop(8, n); } catch (error) { n = error.name.length; } if (i % 50 === 49 && texts.length) console.log(i, n, String(evaluate(texts.shift()))); if (later) later(i); } return n; }
console.log(run(500));
texts.push("1 + 1", "scale = 0.5", "scale = 2; view.length", "view = new Float64Array(16); 'wider'", "add = function (a, b) { return a - b; }; 'other'", "view = [1, 2, 3]; view.length", "view = null", "view = new Int32Array(4); view.length", "later = function (i) { if (i % 7 === 0) view = new Uint8Array(16); }; 'later'", "doubles = { 0: 1, 1: '2' }; 'object'");
console.log(run(600));
console.log(typeof add, typeof view, scale, loop(20, 1), step(3, 4));
