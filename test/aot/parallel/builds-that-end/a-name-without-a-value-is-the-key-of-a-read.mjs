const stages = ["idle", "busy", "done"];
const table = { undefined: "nothing yet", 1: "one" };
let chosen;
function choose() {
  chosen = 1;
}
function read() {
  return [stages[chosen], table[chosen]].join();
}
console.log(read());
choose();
console.log(read());
function around(flag) {
  let place;
  if (flag) place = 2;
  return [stages[place], table[place]].join();
}
console.log(around(true), around(false));
function ahead() {
  return table[hoisted];
}
console.log(ahead());
var hoisted = 1;
console.log(ahead());
for (var turn = 0; turn < 2; turn++) console.log(byTurn());
function byTurn() {
  return stages[turn];
}
