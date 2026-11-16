'use strict';
Object.defineProperty(process.env, 'K_LEVEL', { value: 7, enumerable: true, configurable: true, writable: true });
function level() { return process.env.K_LEVEL; }
function f(t) { let s = 0; for (let i = 0; i < 20; i++) s += level() + (typeof level() === 'number' ? 1 : 2); return s + t % 2; }
const n = 7; let sum = 0; for (let t = 0; t < n; t++) sum = (sum + f(t)) % 1000003; console.log(Math.floor(sum), typeof level());
