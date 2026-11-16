// length read behind a store of it: grown, cut, equal; frozen and subclassed lists; stores that throw.
const l = []; function cut(turns) { let n = 0; for (let k = 0; k < turns; k++) { l.push(1, 2, 3, 4); l.length = 2; n += l.length; l.length = 0; n += l.length * 100 + l.push(7); l.length = k % 5; n += l.length; } return n; }
console.log(cut(0), cut(1), cut(100), l.length);
function set(list, to) { try { list.length = to; return list.length + ' ' + Object.keys(list).length; } catch (error) { return error.name + list.length; } }
for (const make of [() => [1, 2, 3], () => [1.5, 2], () => ['a', , 'c'], () => [], () => Object.freeze([1, 2]), () => Object.seal([1, 2, 3]), () => Object.defineProperty([1, 2], 'length', { writable: false }), () => Object.defineProperty([1, 2, 3], 1, { configurable: false })])
  for (const to of [0, 1, 2, 3, 100, 4294967295]) console.log(set(make(), to));
for (const to of [-1, 1.5, 4294967296, '2', NaN]) console.log(set([1, 2, 3], to));
class Own extends Array { } console.log(set(Own.from([1, 2, 3]), 2));
