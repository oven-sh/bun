// What arrives is odd: a text in a field, a getter, a missing name, a hole, null, a number in the list.
// STATISTIC: ElementsOfListsGuessedByNamesNotAskedForLayoutsThatStayWithCompiledCode >= 0
'use strict';
function weighOne(i) { const crate = { wide: i + 0.5, tall: i * 0.5 + 0.25, drift: i * 0.25 + 0.125, sink: 0.5 }; return crate.wide + crate.tall + crate.drift + crate.sink; }
function shift(list, by) { let said = ''; for (let i = 0; i < list.length; i++) { const c = list[i]; try { c.sink += 9.8 * by; c.wide += c.drift * by; c.tall += c.sink * by; said += c.wide + '|' + c.tall + '|' + c.sink + ';'; } catch (error) { said += error.constructor.name + ';'; } } return said; }
const odd = JSON.parse('[{"wide":"a","tall":1,"drift":2,"sink":3},{"tall":1.5,"sink":0.5},null,7,{"wide":1,"tall":2,"drift":3,"sink":4,"more":5}]');
let asked = 0;
odd.push({ get wide() { asked++; return 2.5; }, set wide(to) { asked += 10; }, tall: 1, drift: 2, sink: 3 });
odd.length = 8;
odd.push(Object.freeze({ wide: 1, tall: 2, drift: 3, sink: 4 }));
console.log(weighOne(2));
for (let turn = 0; turn < 3; turn++) console.log(shift(odd, 0.5));
console.log(asked, JSON.stringify(odd));
