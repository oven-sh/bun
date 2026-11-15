'use strict';
// COUNT: operation:operationAOTMulNumberAndValueAsNumber <= 8
// COUNT: operation:operationAOTSubNumberAndValueAsNumber <= 8
// COUNT: operation:operationAOTDivNumberAndValueAsNumber <= 8
// A list out of outside data holds truths, nothing and null. Each is reckoned with beside a fraction, on either side, in a loop: the test for a number fails and the arm knows that it is no number.
const flags = JSON.parse('[' + Array.from({ length: 48 }, (_, i) => ['true', 'false', 'null'][i % 3]).join() + ']');
function times(half) { let s = 0; for (let i = 0; i < flags.length; i++) { const x = flags[i]; s = s + x * half; } return s; }
function minus(half) { let s = 0; for (let i = 0; i < flags.length; i++) { const x = flags[i]; s = s + (half - x); } return s; }
function minusBack(half) { let s = 0; for (let i = 0; i < flags.length; i++) { const x = flags[i]; s = s + (x - half); } return s; }
function plus(half) { let s = 0; for (let i = 0; i < flags.length; i++) { const x = flags[i]; s = s + (x + half); } return s; }
function over(half) { let s = 0; for (let i = 0; i < flags.length; i++) { const x = flags[i]; s = s + x / half; } return s; }
function overBack(half) { let s = ''; for (let i = 0; i < 6; i++) { const x = flags[i]; s += half / x + ' '; } return s; }
const out = []; for (let t = 0; t < 6; t++) { const half = t + 0.5; out.push(times(half), minus(half), minusBack(half), plus(half), over(half), overBack(half)); }
console.log(out.join('|'));
