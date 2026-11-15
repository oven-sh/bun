'use strict';
const list = JSON.parse('[1.5, -0.0, 2.5, 0, 3.5]'); list.push(NaN, -0, 0 / -1);
function find(t) { const x = t & 3; for (let i = 0; i < list.length; i++) if (list[i] === x) return i; return -1; }
function loose(t) { const x = t & 3; let c = 0; for (let i = 0; i < list.length; i++) if (list[i] == x) c++; return c; }
function unlike(t) { const x = t | 0; let c = 0; for (let i = 0; i < list.length; i++) if (list[i] !== x) c++; return c; }
const said = []; for (let t = 0; t < 8; t++) said.push(find(t), loose(t), unlike(t)); console.log(said.join());
