'use strict';
const kinds = [JSON.parse('[1, 2, 7, 3, 1, 50]'), JSON.parse('[1.5, 2, 7.0, 1]'), JSON.parse('["1", 1, null, 7, {"a": 2}]'), JSON.parse('[]')];
function weigh(s) { let c = 0; for (let i = 0; i < s.length; i++) switch (s[i]) { case 1: c++; break; case 2: c += 2; break; case 7: c += 3; break; } return c; }
globalThis.kept = weigh;
const said = []; for (let t = 0; t < 8; t++) said.push(weigh(kinds[t & 3])); console.log(said.join());
