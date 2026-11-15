function make() { return function (row) { return row.width * 2 + row.height; }; }
const Twice = make();
let sum = 0;
for (let turn = 0; turn < 200; turn++) sum += Twice({ width: turn, height: 1 });
const again = new Twice({ width: 1, height: 2 }).constructor;
console.log(sum, again === Twice, again({ depth: 9, height: 5, width: 7 }), String(again("text")), String(again(12.5)), String(again([3])));
