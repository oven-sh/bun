function look(list) { return [list.length, list[0], list.at(0), list.at(-1), list[4294967295], list[4294967296], Object.keys(list).length].join(); }
function grow(list, how) { try { how(list); return "no throw"; } catch (error) { return error.constructor.name; } }
const n = 4294967290 + [1, 2, 3, 4, 5].length; const a = [1]; a.length = n; console.log(grow(a, l => l.push(2, 3)), look(a));
