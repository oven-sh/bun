'use strict';
const list = JSON.parse('[' + Array.from({ length: 24 }, (_, i) => i + 0.5).join() + ']'); delete list[3]; delete list[20]; list[30] = 8;
function find(t) { const x = t & 15; for (let i = 0; i < list.length; i++) if (list[i] === x) return i; return -1; }
function unlike(t) { const x = t & 15; let c = 0; for (let i = 0; i < list.length; i++) if (list[i] !== x) c++; return c; }
const said = []; for (let t = 0; t < 20; t++) said.push(find(t), unlike(t)); console.log(said.join());
