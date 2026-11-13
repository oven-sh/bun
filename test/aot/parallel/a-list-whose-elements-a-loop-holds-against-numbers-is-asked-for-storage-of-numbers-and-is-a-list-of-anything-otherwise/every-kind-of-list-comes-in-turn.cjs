'use strict';
const lists = [JSON.parse('[0.5, 1.5, 2, 3.5]'), JSON.parse('[3, 2, 1, 0]'), JSON.parse('["2", 2, "x"]'), JSON.parse('[]'), JSON.parse('[null, 1]')];
function find(list, t) { const x = t & 3; for (let i = 0; i < list.length; i++) if (list[i] === x) return i; return -1; }
const said = []; for (let t = 0; t < 24; t++) said.push(find(lists[t % 5], t)); console.log(said.join());
