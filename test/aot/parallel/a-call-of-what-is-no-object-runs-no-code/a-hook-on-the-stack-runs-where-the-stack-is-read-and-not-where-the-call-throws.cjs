'use strict';
// Error.prepareStackTrace is code of the program that an error may run: at the first read of its stack, which is an operation of the handler, and not at the throw.
function add(out, a, b) { out[0] = a[0] + b[0]; out[1] = a[1] + b[1]; return out; }
const N = {}; N.add = add; if (process.argv.length > 99) N.gone = add;
const o = new Float64Array(2), p = new Float64Array([1.5, 2.5]), q = new Float64Array([0.5, 0.25]);
let ran = 0; Error.prepareStackTrace = () => { ran++; o[0] = -1; return "made by the hook"; };
function f(t, last) { let s = 0; try { for (let i = 0; i < 10; i++) { p[i & 1] = i + t; if (i === last) N.gone(o, p, q); else N.add(o, p, q); s += o[0]; } } catch (e) { const before = ran + " " + o[0]; const stack = e.stack; return s + " | " + before + " | " + stack + " | " + ran + " " + o[0]; } return "through with " + s; }
const n = +process.argv[2] || 5; for (let t = 0; t < n; t++) console.log(f(t, 6 + t));
