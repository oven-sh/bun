// What a default does beside its number runs where the default is taken, and nowhere else.
const rows = JSON.parse('[' + Array.from({ length: 40 }, (_, i) => `{"id":${i}${i % 3 ? `,"extra":${i}` : i % 2 ? ',"extra":null' : ''}}`).join(',') + ']');
let calls = 0;
function localDefault(list) { let s = 0, hits = 0; for (let i = 0; i < list.length; i++) s += list[i].extra ?? (hits++, 0); return [s, hits]; }
function falsy(list) { let s = 0, hits = 0; for (let i = 0; i < list.length; i++) s += list[i].extra || (hits++, 7); return [s, hits]; }
function variable(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i].extra ?? (calls++, 0); return [s, calls]; }
function field(list, o) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i].extra ?? (o.n++, 3); return [s, o.n]; }
function assigned(list) { let s = 0, last = -1; for (let i = 0; i < list.length; i++) s += list[i].extra ?? (last = i, 5); return [s, last]; }
function assignedRow(list) { let s = 0, last = null; for (const row of list) s += row.extra ?? (last = row, 5); return [s, last?.id]; }
function found(list) { let s = 0, last = -1; for (let i = 0; i < list.length; i++) { const x = list[i].extra; s += x == null ? 5 : (last = i, x); } return [s, last]; }
function foundCounted(list) { let s = 0, hits = 0; for (let i = 0; i < list.length; i++) { const x = list[i].extra; s += x == null ? 0 : (hits++, x); } return [s, hits]; }
function foundCalls(list) { let s = 0; for (let i = 0; i < list.length; i++) { const x = list[i].extra; s += x === undefined || x === null ? 1 : (calls++, x); } return [s, calls]; }
function truthy(list, o) { let s = 0; for (let i = 0; i < list.length; i++) { const x = list[i].extra; s += x ? (o.n++, x) : 2; } return [s, o.n]; }
function plainDefault(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i].extra ?? 4; return [s]; }
function twice(list) { let s = 0, n = 0; for (let i = 0; i < list.length; i++) { s += list[i].extra ?? 1; n += list[i].extra ?? (calls += 2, 1); } return [s, n, calls]; }
function written(list) { let s = 0; for (let i = 0; i < list.length; i++) { const { extra = (calls++, 6) } = list[i]; s += extra; } return [s, calls]; }
function logged(list, o) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i].extra ?? (o.log.push(i), 2); return [s, o.log.length]; }
function testedSum(list) { let s = 0; for (let i = 0; i < list.length; i++) s += +(list[i].extra ?? (calls++, 1)) ? 1 : 0; return [s, calls]; }
function testedFraction(list) { let s = 0; for (let i = 0; i < list.length; i++) s += (i + (list[i].extra ?? (calls++, 0.5))) ? 1 : 2; return [s, calls]; }
function compared(list) { let s = 0; for (let i = 0; i < list.length; i++) if ((list[i].extra ?? (calls++, 4)) > 3) s++; return [s, calls]; }
globalThis.functions = [testedSum, testedFraction, compared, localDefault, falsy, variable, field, assigned, assignedRow, found, foundCounted, foundCalls, truthy, plainDefault, twice, written, logged];
for (let k = 0; k < 4; k++)
    for (const f of globalThis.functions)
        console.log(f.name, JSON.stringify(f(rows, { n: 1, log: [] })));
for (const f of globalThis.functions)
    console.log(f.name, JSON.stringify(f(JSON.parse('[{"extra":"3"},{"extra":2},{},{"extra":true},{"id":1}]'), { n: 1, log: [] })));
