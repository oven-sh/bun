// A function declared in the block of a loop is stored to the variable of its name around it, which is declared without a value.
// The output is stored: plain Bun leaves the store out where the block evaluates no text.
function throughForOf() {
  var found;
  for (const turn of [1, 2]) {
    function found() { return turn; }
  }
  return typeof found + (found && found());
}
function beside(text) {
  var found;
  for (const turn of [1, 2]) {
    function found() { return turn; }
    eval(text);
  }
  return found ? found() : "nothing";
}
function throughFor(text) {
  var found;
  for (let turn = 0; turn < 3; turn++) {
    function found() { return eval(text); }
  }
  return found ? found() : "nothing";
}
function throughWhile() {
  var found;
  let turn = 0;
  while (turn < 2) {
    let here = ++turn;
    function found() { return here; }
    (() => eval("found"))();
  }
  return found === undefined ? "nothing" : found();
}
function inAnArm(yes) {
  var found;
  for (const turn of [1, 2]) {
    if (turn === yes) {
      function found() { return turn; }
    }
  }
  return found ? found() : "nothing";
}
function inAClause(turns) {
  { var found; }
  for (const turn of turns) {
    switch (turn) {
      case 1:
        function found() { return turn; }
    }
  }
  return found ? found() : "nothing";
}
function seenByAClosure() {
  var found;
  const read = () => found;
  let turns = 0;
  do {
    function found() { return eval("5"); }
  } while (!read() && ++turns < 3);
  return read() ? read()() + turns : "nothing";
}
function assigned() {
  var found;
  for (const turn of [1]) {
    function found() { return 8; }
  }
  found ??= () => 9;
  return found();
}
function neverStored() {
  var found;
  eval("2");
  return found === undefined ? "nothing" : "something";
}
console.log(throughForOf(), beside("1"), throughFor("turn"), throughWhile());
console.log(inAnArm(1), inAnArm(2), inAnArm(3), inAClause([1]), inAClause([2]));
console.log(seenByAClosure(), assigned(), neverStored());
/* Output:
function2 2 2 2
1 2 nothing 1 nothing
5 8 nothing
*/
