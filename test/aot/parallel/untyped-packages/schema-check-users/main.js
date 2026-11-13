// An untyped package and a program of it (users): schemas made by chained calls, compiled to closures; references, unions, transforms, paths of errors
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
const { s } = lib, user = s.obj({ id: s.num().int().min(1), name: s.text().trim().min(2).max(8), mail: s.text().email().optional(), role: s.lit('admin', 'user', 3).default('user'), tags: s.list(s.text()).unique().default(() => []), at: s.tuple(s.num(), s.num()).nullable().optional(), age: s.coerce.num().transform(n => n * 2).optional() });
const inputs = [{ id: 1, name: ' Ann ' }, { id: 0, name: 'B' }, { id: 1.5, name: 'toolongname', mail: 'x' }, { id: '1', name: 5, role: 'root', tags: ['a', 'a'] }, { id: 7, name: 'Zed', mail: 'z@z.example', role: 3, tags: ['p', 'q'], at: [1, 2], age: '21' }, { id: 2, name: 'Al', at: null, extra: 1 }, { id: 2, name: 'Al', at: [1], age: 'x' }, null, [], 'text', { id: NaN, name: undefined, at: [1, 'b'], tags: [1, null] }]; const kinds = [user, user.strict(), user.loose(), user.partial(), user.pick('id', 'name'), user.extend({ extra: s.num().max(0) }), user.rest(s.bool())];
inputs.forEach((v, i) => kinds.forEach((k, n) => { const r = k.safe(v); say(i, n, r.ok ? JSON.stringify(r.value) : r.issues.join(' | ')); })); try { user.parse({}); } catch (e) { say(e.name, e.message, e instanceof Error, e.issues.length); }
