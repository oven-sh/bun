'use strict';
const list = JSON.parse('[' + Array.from({ length: 40 }, (_, i) => i * 3 % 41).join() + ']');
function find(t) { const x = t & 63; for (let i = 0; i < list.length; i++) if (list[i] === x) return i; return -1; }
function count(t) { const x = t & 7; let c = 0; for (let i = 0; i < list.length; i++) if (list[i] !== x) c++; return c; }
const said = []; for (let t = 0; t < 70; t++) said.push(find(t), count(t)); console.log(said.join());
