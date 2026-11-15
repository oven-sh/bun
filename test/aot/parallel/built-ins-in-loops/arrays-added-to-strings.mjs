// A string plus an array in loops: numbers, texts, nested and empty arrays, holes, arrays that know themselves, replaced join and toString.
const lists = [[1, 2, 3], [], ['a', 'b'], [1.5, -0, NaN], [null, undefined, true], [[1, [2]], [3]], [, 1, , 2], [{}, () => 1 ? 'f' : 0].slice(0, 1), [10n, 'x'], Array.from({ length: 30 }, (_, i) => i)];
const self = [1]; self.push(self); lists.push(self);
const fixed = [1, 2, 3], o = { a: 1, b: 2 };
function turns(n) { let t = 0; for (let k = 0; k < n; k++) t += ('' + fixed).length + (' ' + Object.keys(o)).length + (k + ':' + fixed).length; return t; }
console.log(turns(100));
function all() { const out = []; for (const l of lists) out.push('<' + l, 'x' + l + 'y', '' + l, l + ''); return out.join('|'); }
console.log(all()); console.log(all());
fixed.push('four'); o.c = 3; console.log(turns(3));
fixed.join = () => 'joined'; console.log(turns(2)); delete fixed.join;
fixed.toString = () => 'own'; console.log(turns(2)); delete fixed.toString;
fixed[Symbol.toPrimitive] = hint => 'hint ' + hint; console.log(turns(2)); delete fixed[Symbol.toPrimitive];
const thrown = []; thrown.toString = () => { throw new Error('thrown'); };
function throws() { for (let k = 0; k < 2; k++) { try { console.log('a' + thrown); } catch (error) { console.log(error.message); } } }
throws(); lists.push([Symbol('s')]); try { all(); } catch (error) { console.log(error.name); }
