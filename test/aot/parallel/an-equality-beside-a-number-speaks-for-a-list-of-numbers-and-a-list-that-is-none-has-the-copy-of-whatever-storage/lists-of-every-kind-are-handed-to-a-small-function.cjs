'use strict';
const kinds = [JSON.parse('[0.5, 1.5, 2, 3.5]'), JSON.parse('[3, 2, 1, 0]'), JSON.parse('["2", 2, "x"]'), JSON.parse('[]'), JSON.parse('[null, 1, true, {"a": 1}, [1]]')];
function unlike(l, x) { let c = 0; for (let i = 0; i < l.length; i++) if (l[i] !== x) c++; return c; }
function find(l, x) { for (let i = 0; i < l.length; i++) if (l[i] === x) return i; return -1; }
function f(t) { return unlike(kinds[0], t & 3) * 1000 + unlike(kinds[1], t & 3) * 100 + unlike(kinds[2], t & 3) * 10 + unlike(kinds[4], t & 1) + find(kinds[3], t & 1); }
const said = []; for (let t = 0; t < 12; t++) said.push(f(t), find(kinds[t % 5], t & 3)); console.log(said.join());
