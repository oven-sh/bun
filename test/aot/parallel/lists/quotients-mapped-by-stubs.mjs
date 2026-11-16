// STATISTIC: ArrayCallbacksRunByStubs >= 3
// map() with callbacks that divide an element or one of its fields by a number.
const one = Number("1");
let seen = 0;
function thirds(list, c) { if (c === "never") { console.log('never 0', c * 2, c - 0, 'x' + c, c % 3); console.log('never 1', c * 3, c - 1, 'x' + c, c % 4); console.log('never 2', c * 4, c - 2, 'x' + c, c % 5); console.log('never 3', c * 5, c - 3, 'x' + c, c % 6); console.log('never 4', c * 6, c - 4, 'x' + c, c % 7); console.log('never 5', c * 7, c - 5, 'x' + c, c % 8); console.log('never 6', c * 8, c - 6, 'x' + c, c % 9); console.log('never 7', c * 9, c - 7, 'x' + c, c % 10); console.log('never 8', c * 10, c - 8, 'x' + c, c % 11); console.log('never 9', c * 11, c - 9, 'x' + c, c % 12); console.log('never 10', c * 12, c - 10, 'x' + c, c % 13); console.log('never 11', c * 13, c - 11, 'x' + c, c % 14); console.log('never 12', c * 14, c - 12, 'x' + c, c % 15); console.log('never 13', c * 15, c - 13, 'x' + c, c % 16); console.log('never 14', c * 16, c - 14, 'x' + c, c % 17); console.log('never 15', c * 17, c - 15, 'x' + c, c % 18); console.log('never 16', c * 18, c - 16, 'x' + c, c % 19); console.log('never 17', c * 19, c - 17, 'x' + c, c % 20); console.log('never 18', c * 20, c - 18, 'x' + c, c % 21); console.log('never 19', c * 21, c - 19, 'x' + c, c % 22); console.log('never 20', c * 22, c - 20, 'x' + c, c % 23); console.log('never 21', c * 23, c - 21, 'x' + c, c % 24); console.log('never 22', c * 24, c - 22, 'x' + c, c % 25); console.log('never 23', c * 25, c - 23, 'x' + c, c % 26); } return list.map(x => x / 3); }
function shares(list, c) { if (c === "never") { console.log('never 0', c * 2, c - 0, 'x' + c, c % 3); console.log('never 1', c * 3, c - 1, 'x' + c, c % 4); console.log('never 2', c * 4, c - 2, 'x' + c, c % 5); console.log('never 3', c * 5, c - 3, 'x' + c, c % 6); console.log('never 4', c * 6, c - 4, 'x' + c, c % 7); console.log('never 5', c * 7, c - 5, 'x' + c, c % 8); console.log('never 6', c * 8, c - 6, 'x' + c, c % 9); console.log('never 7', c * 9, c - 7, 'x' + c, c % 10); console.log('never 8', c * 10, c - 8, 'x' + c, c % 11); console.log('never 9', c * 11, c - 9, 'x' + c, c % 12); console.log('never 10', c * 12, c - 10, 'x' + c, c % 13); console.log('never 11', c * 13, c - 11, 'x' + c, c % 14); console.log('never 12', c * 14, c - 12, 'x' + c, c % 15); console.log('never 13', c * 15, c - 13, 'x' + c, c % 16); console.log('never 14', c * 16, c - 14, 'x' + c, c % 17); console.log('never 15', c * 17, c - 15, 'x' + c, c % 18); console.log('never 16', c * 18, c - 16, 'x' + c, c % 19); console.log('never 17', c * 19, c - 17, 'x' + c, c % 20); console.log('never 18', c * 20, c - 18, 'x' + c, c % 21); console.log('never 19', c * 21, c - 19, 'x' + c, c % 22); console.log('never 20', c * 22, c - 20, 'x' + c, c % 23); console.log('never 21', c * 23, c - 21, 'x' + c, c % 24); console.log('never 22', c * 24, c - 22, 'x' + c, c % 25); console.log('never 23', c * 25, c - 23, 'x' + c, c % 26); } return list.map(x => x.age / c); }
function halves(list, c) { if (c === "never") { console.log('never 0', c * 2, c - 0, 'x' + c, c % 3); console.log('never 1', c * 3, c - 1, 'x' + c, c % 4); console.log('never 2', c * 4, c - 2, 'x' + c, c % 5); console.log('never 3', c * 5, c - 3, 'x' + c, c % 6); console.log('never 4', c * 6, c - 4, 'x' + c, c % 7); console.log('never 5', c * 7, c - 5, 'x' + c, c % 8); console.log('never 6', c * 8, c - 6, 'x' + c, c % 9); console.log('never 7', c * 9, c - 7, 'x' + c, c % 10); console.log('never 8', c * 10, c - 8, 'x' + c, c % 11); console.log('never 9', c * 11, c - 9, 'x' + c, c % 12); console.log('never 10', c * 12, c - 10, 'x' + c, c % 13); console.log('never 11', c * 13, c - 11, 'x' + c, c % 14); console.log('never 12', c * 14, c - 12, 'x' + c, c % 15); console.log('never 13', c * 15, c - 13, 'x' + c, c % 16); console.log('never 14', c * 16, c - 14, 'x' + c, c % 17); console.log('never 15', c * 17, c - 15, 'x' + c, c % 18); console.log('never 16', c * 18, c - 16, 'x' + c, c % 19); console.log('never 17', c * 19, c - 17, 'x' + c, c % 20); console.log('never 18', c * 20, c - 18, 'x' + c, c % 21); console.log('never 19', c * 21, c - 19, 'x' + c, c % 22); console.log('never 20', c * 22, c - 20, 'x' + c, c % 23); console.log('never 21', c * 23, c - 21, 'x' + c, c % 24); console.log('never 22', c * 24, c - 22, 'x' + c, c % 25); console.log('never 23', c * 25, c - 23, 'x' + c, c % 26); } const made = list.map(x => x.age / 2); made.push(c); return made; }
const text = list => list.length + ":" + Array.from(list, v => Object.is(v, -0) ? "-0" : typeof v === "string" ? JSON.stringify(v) : String(v)).join();
const numbers = [[3, 6, 7], [0, -0, 1.5], [2147483647, -2147483648], [NaN, 1], [], ["3", 6], [1, , 2], [undefined], [null, 9], Object.freeze([9, 12])].concat([JSON.parse("[3, 4, 5.5]")]);
const records = [[{ age: 3 }, { age: 7 }], [{ age: 0.5 }, { age: -0 }], [{ age: 1 }, { id: 2 }], [{ age: "8" }], [{ age: 4 }, { get age() { seen++; return 5; } }], [{ age: 4 }, null], [], JSON.parse('[{"id":1,"age":6},{"id":2,"age":9}]'), [Object.create({ age: 6 }), { age: one }]];
function ask() {
  for (const list of numbers) {
    let said;
    try { said = text(thirds(list, 1)); } catch (e) { said = e.constructor.name; }
    console.log("thirds", said);
  }
  for (const list of records) {
    for (const c of [2, 0, -0, 0.25, "4", undefined, 3n]) {
      let said;
      try { said = text(shares(list, c)); } catch (e) { said = e.constructor.name; }
      console.log("shares", String(c), said);
    }
    let said;
    try { said = text(halves(list, 1)); } catch (e) { said = e.constructor.name; }
    console.log("halves", said);
  }
}
for (let k = 0; k < 3; k++) ask();
console.log(seen);
