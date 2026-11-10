'use strict';
const grows = JSON.parse('[1, 2, 3, 4]');
function find(l, x) { for (let i = 0; i < l.length; i++) if (l[i] === x) return i; return -1; }
function f(t) { return find(grows, t & 7); }
const said = []; for (let t = 0; t < 8; t++) said.push(f(t)); grows[1] = "two"; for (let t = 0; t < 8; t++) said.push(f(t)); grows[1] = 2.5; for (let t = 0; t < 8; t++) said.push(f(t)); console.log(said.join());
