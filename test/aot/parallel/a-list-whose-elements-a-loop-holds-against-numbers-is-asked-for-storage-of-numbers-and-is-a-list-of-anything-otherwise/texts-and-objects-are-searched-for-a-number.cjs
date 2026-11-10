'use strict';
const texts = JSON.parse('["0", "1", "2", "3", "4"]'), mixed = JSON.parse('[1.5, "2", 2, null, true, {"a": 3}, [3], 3]');
function findIn(list, t) { const x = t & 3; for (let i = 0; i < list.length; i++) if (list[i] === x) return i; return -1; }
function looseIn(list, t) { const x = t & 3; for (let i = 0; i < list.length; i++) if (list[i] == x) return i; return -1; }
const said = []; for (let t = 0; t < 8; t++) said.push(findIn(texts, t), looseIn(texts, t), findIn(mixed, t), looseIn(mixed, t)); console.log(said.join());
