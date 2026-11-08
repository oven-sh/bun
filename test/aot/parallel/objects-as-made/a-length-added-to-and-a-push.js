function look(list) { return [list.length, list[0], list.at(0), list.at(-1), list[4294967295], list[4294967296], Object.keys(list).length].join(); }
function grow(list, how) { try { how(list); return "no throw"; } catch (error) { return error.constructor.name; } }
const a = [1]; a.length += 4294967294; console.log(grow(a, l => l.push(2)), look(a));
