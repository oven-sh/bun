// Loops read fields of records that JSON.parse has made, under names that objects of the program have as well.
// STATISTIC: SiteCachedReadsEmittedInline >= 16
const small = JSON.parse(JSON.stringify(Array.from({ length: 12 }, (_, i) => ({ id: i, name: "n" + i, age: i * 2 }))));
const wide = JSON.parse(JSON.stringify(Array.from({ length: 12 }, (_, i) => ({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, id: i, name: "w" + i, age: i / 2 }))));
let seen = 0;
function records(list) { const r = []; for (let i = 0; i < list.length; i++) { const u = list[i]; r.push({ id: u.id, name: u.name }); } return r; }
function walked(list) { const r = []; for (const u of list) r.push({ name: u.name, age: u.age }); return r; }
function stored(list) { let k = 0; for (const u of list) { k += u.id; if (k % 5 === 0) u.age = k; k += u.age; if (k % 7 === 0) delete u.name; k += String(u.name).length; } return k; }
const text = v => typeof v === "object" ? v.map(x => [x.id, x.name, x.age].join("/")).join() : String(v);
const changes = [
  list => list.length,
  list => { list[3].late = 1; delete list[4].age; },
  list => { Object.defineProperty(list[2], "name", { get() { seen++; return "got"; }, configurable: true, enumerable: true }); },
  list => { list[5] = Object.create(list[6]); list[5].id = -5; },
  list => { list[7] = new Proxy(list[8], {}); },
  list => { list[0] = "text"; list[1] = 7; },
  list => { Object.freeze(list[9]); list.forEach(u => Object.isFrozen(u)); },
  list => { for (let i = 0; i < 70; i++) list[10]["extra" + i] = i; },
  list => { delete list[2]; },
  list => { list[1] = null; },
];
for (const change of changes) {
  for (const source of [small, wide]) {
    for (const f of [records, walked, stored]) {
      for (let k = 0; k < 2; k++) {
        const list = JSON.parse(JSON.stringify(source));
        change(list);
        let said;
        try { said = text(f(list)); } catch (e) { said = e.constructor.name; }
        console.log(f.name, said);
      }
    }
  }
}
console.log(seen);
