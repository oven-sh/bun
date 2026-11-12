// Flags: --react-compiler
// The test of a case stands in the block of its switch and in no list of statements. What is moved out of it is declared in the list of that case.
const rate = 100, Rate = { of: 100 };
function scale(n) { return n * 100; }
const made = [];
switch (1) {
  case made.push(function (items) { "use memo"; return items.map(n => n * rate).join("+"); }):
    let rate = 3;
}
for (const turn of [4, 5]) {
  switch (made.length + 1) {
    case made.push(function (items) { "use memo"; return items.map(n => n * rate).join("+"); }):
      const rate = turn;
  }
}
switch (4) {
  case made.push(function (items) { "use memo"; return items.map(n => scale(n)).join("+"); }):
    function scale(n) { return n * 6; }
}
console.log(made.map(bill => bill([1, 2])).join());
const said = [];
switch (2) {
  case 1: class Rate { static of = 3; }
  case said.push(function (items) { "use memo"; return items.map(n => typeof Rate).join("+"); }) + 1:
    try { said.push(said[0]([1])); } catch (error) { said.push(error.name); }
}
console.log(said[1]);
