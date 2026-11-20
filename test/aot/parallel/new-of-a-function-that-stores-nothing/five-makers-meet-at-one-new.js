const given = JSON.parse('{"text":"7","name":"constructor"}');
function twice(count) { return count * 2; }
function make0() { return function (count) { return twice(count) + 0; }; }
function make1() { return function (count) { return twice(count) + 1; }; }
function make2() { return function (count) { return twice(count) + 2; }; }
function make3() { return function (count) { return twice(count) + 3; }; }
function make4() { return function (count) { return twice(count) + 4; }; }
const all = [make0(), make1(), make2(), make3(), make4()], said = [];
for (let turn = 0; turn < 5; turn++) { const Either = all[turn], again = new Either(turn)[given.name]; again.mark = turn; said.push(again === Either, again(given.text)); }
for (const each of all) said.push(each.mark);
console.log("SAID " + said.join().length + " " + said.slice(0, 6).join());
