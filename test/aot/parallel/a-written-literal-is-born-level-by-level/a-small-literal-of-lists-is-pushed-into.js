// A literal of lists and leaves alone, of no more than sixteen nodes, written in a function: the walk lays it out in line, each inner list with storage of its own. Each call makes it anew: what one call pushes, stores, cuts or sorts is not seen by the next.
function make(k) { const levels = [['or'], ['and'], ['==', '<', '>'], ['+', '-'], ['*', '/']]; levels[2].push('!=', '<=', '>=', 'in'); levels[3].push('||'); levels[4][0] = k; levels[0].length = 0; levels[1].unshift(k); levels[2].sort(); return levels; }
const go = { make }[JSON.parse('"make"')];
const first = go(1), second = go(2);
console.log(JSON.stringify(first), JSON.stringify(second), first[2] === second[2]);
first[3].push('kept'); console.log(JSON.stringify(go(3)), JSON.stringify(first[3]));
