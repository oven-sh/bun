function look(list) { return [list.length, list[0], list.at(0), list.at(-1), list[4294967295], list[4294967296], Object.keys(list).length].join(); }
function grow(list, how) { try { how(list); return "no throw"; } catch (error) { return error.constructor.name; } }
const sizes = [4294967295]; const a = new Array(...sizes); console.log(grow(a, l => l.push(2)), look(a));
