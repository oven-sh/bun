'use strict';
const kinds = [JSON.parse('[{"a":1}, 0, {"a":2}, 0, 0]'), JSON.parse('[null, 0, null, 1]'), JSON.parse('[true, false, 0, 1]'), JSON.parse('[[0], 0, [1], "0"]')];
function zerosOf(l) { let c = 0; for (let i = 0; i < l.length; i++) if (l[i] === 0) c++; return c; }
globalThis.kept = zerosOf;
const first = kinds[0];
function zerosOfFirst(t) { const x = t & 1; let c = 0; for (let i = 0; i < first.length; i++) if (first[i] === x) c++; return c; }
const said = []; for (let t = 0; t < 12; t++) said.push(zerosOf(kinds[t & 3]), zerosOfFirst(t)); console.log(said.join());
