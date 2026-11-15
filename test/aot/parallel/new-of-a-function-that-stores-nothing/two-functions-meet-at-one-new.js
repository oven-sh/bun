function makeFirst() { return function (row) { return row.width; }; }
function makeSecond() { return function (row) { return row.height; }; }
const First = makeFirst(), Second = makeSecond();
let sum = 0;
for (let turn = 0; turn < 200; turn++) sum += First({ width: turn, height: 1 }) + Second({ width: 1, height: turn });
const said = [];
for (let turn = 0; turn < 4; turn++) {
  const Either = turn % 2 ? First : Second;
  const again = new Either({ width: 1, height: 2 }).constructor;
  again.mark = (again.mark || 0) + turn;
  said.push(String(again("text")), String(again({ height: 3 })));
}
console.log(sum, First.mark, Second.mark, said.join());
