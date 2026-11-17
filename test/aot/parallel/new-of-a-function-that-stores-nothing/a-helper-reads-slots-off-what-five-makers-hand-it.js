const given = JSON.parse('{"name":"constructor"}');
function width(row) { let sum = 0; for (let i = 0; i < 3; i++) { try { sum += row.width + i; } catch (error) { sum -= 1; } } for (let i = 0; i < 2; i++) sum += row.height; return sum; }
function make0() { return function (row) { return width(row) + 0; }; } function make1() { return function (row) { return width(row) + 1; }; } function make2() { return function (row) { return width(row) + 2; }; } function make3() { return function (row) { return width(row) + 3; }; } function make4() { return function (row) { return width(row) + 4; }; }
const all = [make0(), make1(), make2(), make3(), make4()], said = [];
for (let turn = 0; turn < all.length; turn++) { const Either = all[turn]; for (let warm = 0; warm < 50; warm++) Either({ width: 3, height: 1 }); const again = new Either({ width: 3, height: 1 })[given.name]; said.push(String(again({ height: 2, depth: 3, width: 5 }))); said.push(String(again("text"))); said.push(String(again(7.5))); said.push(String(again([1, 2]))); }
console.log(said.join());
