// STATISTIC: InvariantBasesGuardedAsArrays <= 0
'use strict';
const q = Number(process.argv[2] ?? 3);
const rows = JSON.parse('[' + Array.from({ length: 64 }, (_, i) => '{"v":' + (i + q + 0.5) + '}').join() + ']'), nums = JSON.parse('[' + Array.from({ length: 64 }, (_, i) => (i * 37) % 101).join() + ']');
function f(t) { let seen = null, c = 0; for (let i = 0; i < 64; i++) { if (nums[i] > 1000) seen = rows[i]; if (seen) c = c + seen.v; c = c + nums[i]; } return c + t; }
let sum = 0; for (let t = 0; t < 40; t++) sum = sum + f(t); nums[60] = 2000; console.log(sum, f(0));
