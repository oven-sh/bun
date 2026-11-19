'use strict';
const list = JSON.parse('[1.5, -0.0, 2.5, 0, 3.5]'); list.push(NaN, -0); delete list[2]; list[9] = 1;
function unlike(l, x) { let c = 0; for (let i = 0; i < l.length; i++) if (l[i] !== x) c++; return c; }
function loose(l, x) { let c = 0; for (let i = 0; i < l.length; i++) if (l[i] == x) c++; return c; }
function f(t) { return unlike(list, t & 1) * 100 + loose(list, t & 1); }
const said = []; for (let t = 0; t < 6; t++) said.push(f(t)); console.log(said.join());
