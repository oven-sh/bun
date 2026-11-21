// A call that spreads a list is made for what it does, on one arm of a choice, and its answer is dropped where the arms meet: in loops over rows, behind &&, || and ??, in both arms, in a return that nobody reads.
'use strict';
const book = [], seen = [];
function enter(table, ...names) { book.push(table + ':' + names.join('+')); return names.length; }
function refuse(...why) { seen.push(why.length); if (why[0] === 'throw') throw new RangeError(why.join(' ')); }
function evening(rows, open) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i], names = row.names;
    open ? enter(row.table, ...names) : refuse(...names, row.table);
    row.late && refuse(...names);
    row.table > 2 || enter(...names);
    names.length > 2 ? enter(0, ...names.slice(1)) : undefined;
  }
}
const quiet = (list, ok) => void (ok ? enter(...list) : list.forEach(x => refuse(...x)));
function chosen(kind, list) { switch (kind) { case 1: enter(1, ...list); break; case 2: list.length && enter(2, ...list, ...list); break; default: refuse(...list); } }
function tried(list) { try { list.ok ? enter(9, ...list.names) : refuse(...list.names); } catch (error) { seen.push(error.constructor.name); } finally { list.done && enter(...list.done); } }
class Hall { constructor(...seats) { this.seats = seats; } seat(...names) { this.seats.push(...names); return this; } fill(lists) { for (const list of lists) list.length ? this.seat(...list) : this.empty?.(...list); } get all() { return this.seats.join(''); } }
class Balcony extends Hall { constructor(list, high) { super(...list); high ? super.seat(...list) : this.seat('-', ...list); } empty(...none) { this.seats.push('(' + none.length + ')'); } }
const rows = [{ table: 1, names: ['Ada', 'Ben'] }, { table: 3, names: [], late: true }, { table: 4, names: ['Cy', 'Di', 'Ed'], late: 1 }, { table: 2, names: 'fg' }];
for (let k = 0; k < 80; k++) { book.length = seen.length = 0; evening(rows, k & 1); quiet([1, 2], true); chosen(k % 3, [k]); tried({ ok: true, names: [] }); new Balcony(['x'], k % 2).fill([['y'], []]); }
const show = () => { console.log(book.splice(0).join(' '), '|', seen.splice(0).join()); };
show(); evening(rows, true); show(); evening(rows, false); show(); quiet(['a', 'b'], 1); quiet([['c'], ['d', 'e'], []], 0); show();
for (const kind of [0, 1, 2, 3]) { chosen(kind, []); chosen(kind, new Set([5, 6])); chosen(kind, 'xy'); } show();
for (const list of [{ ok: 1, names: [1] }, { ok: 0, names: ['throw', 'it'] }, { ok: 0, names: null, done: ['last'] }, { ok: 1, names: 5 }, { ok: 1, names: { *[Symbol.iterator]() { yield 'one'; yield 'two'; } }, done: [7, 8] }]) tried(list); show();
const told = run => { try { run(); return 'fine'; } catch (error) { return error.constructor.name; } };
console.log(told(() => evening([{ table: 1, names: undefined }], true)), told(() => quiet(3, true)), told(() => evening([{ table: 1, names: { length: 2 } }], false)), told(() => chosen(1, null)), told(() => evening(null, 1))); show();
console.log(new Balcony(['a', 'b'], true).all, new Balcony(['a', 'b'], false).all, new Balcony([], 0).all); const hall = new Balcony('q', 1); hall.fill([['r', 's'], [], new Uint8Array(2), 'tu']); console.log(hall.all);
let steps = ''; const slow = { [Symbol.iterator]() { let n = 0; return { next() { steps += n; return { done: n++ === 3, value: n }; }, return() { steps += 'r'; return {}; } }; } }; tried({ ok: 1, names: slow }); tried({ ok: 0, names: slow }); console.log(steps); show();
evening([{ table: 5, names: [1, , 3] }, { table: 6, names: Object.setPrototypeOf([1, , 3], { __proto__: Array.prototype, 1: 'above' }) }], true); show();
