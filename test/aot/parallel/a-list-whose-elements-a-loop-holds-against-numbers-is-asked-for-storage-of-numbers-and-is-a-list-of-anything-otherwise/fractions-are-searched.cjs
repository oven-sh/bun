'use strict';
const list = JSON.parse('[' + Array.from({ length: 40 }, (_, i) => i + 0.5).join() + ']');
function find(t) { const x = t & 63; for (let i = 0; i < list.length; i++) if (list[i] === x) return i; return -1; }
function findHalf(t) { const x = (t & 63) / 2; for (let i = 0; i < list.length; i++) if (list[i] === x) return i; return -1; }
const said = []; for (let t = 0; t < 70; t++) said.push(find(t), findHalf(t)); console.log(said.join());
