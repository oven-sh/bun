'use strict';
function count(labels, wanted) { let found = 0; for (let i = 0; i < labels.length; i++) { if (labels[i] === wanted) found++; } return found; }
const labels = ['plum', 'pear', , 'plum', 'fig', 'pear']; const asked = ['plum', 'pear', 'fig', 'lime', undefined];
const n = +process.argv[2] || 3000; let out = ''; for (let t = 0; t < n; t++) { out = ''; for (let k = 0; k < asked.length; k++) out += count(labels, asked[k]) + ','; } console.log(out);
