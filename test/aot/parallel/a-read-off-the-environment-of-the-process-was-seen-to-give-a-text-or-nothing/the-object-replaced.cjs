'use strict';
process.env = { K_LEVEL: { length: 5 }, K_HOME: 12 };
function level() { return process.env.K_LEVEL; }
function home() { return process.env.K_HOME; }
function f(t) { let s = 0; for (let i = 0; i < 20; i++) s += level().length + home(); return s + t % 2; }
const n = 7; let sum = 0; for (let t = 0; t < n; t++) sum = (sum + f(t)) % 1000003; console.log(Math.floor(sum), typeof level(), typeof home());
