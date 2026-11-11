'use strict';
function method() { return process.env.hasOwnProperty; }
function f(t) { let s = 0; for (let i = 0; i < 20; i++) s += method().length + (method().call(process.env, 'K_NONE') ? 1 : 2); return s + t % 2; }
const n = 7; let sum = 0; for (let t = 0; t < n; t++) sum = (sum + f(t)) % 1000003; console.log(Math.floor(sum), typeof method());
