'use strict';
const list = JSON.parse('[64.5, 1024, 12, 0.5]');
function shared(t) { const a = (t & 1) + 1, b = a + a, c = b + b, d = c + c, e = d + d, g = e + e, h = g + g, x = h + h + h + h + h + h + h + h; for (let i = 0; i < list.length; i++) if (list[i] === x) return i; return -1; }
function long(t) { const x = (t & 1) + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1; for (let i = 0; i < list.length; i++) if (list[i] === x) return i; return -1; }
console.log(shared(0), shared(1), long(0), long(1));
