// `bun run` prints an `if` whose branch never runs where a declaration in the branch must stay. It prints the test with it, so a name in its dead zone is read, and the read throws.
const show = (name, probe) => {
  let answer;
  try {
    answer = String(probe(true));
  } catch (error) {
    answer = error.name;
  }
  console.log(name + ": " + answer);
};
let calls = 0;
const count = () => ++calls;
show("a function", () => { if (typeof late) {} else { function f() {} } let late = 1; return "no throw " + late; });
show("a function that is the branch", () => { if (typeof late) {} else function f() {} let late = 1; return "no throw " + late; });
show("a function behind a label", () => { if (typeof late) {} else { label: function f() {} } let late = 1; return "no throw " + late; });
show("a function in a loop", () => { if (typeof late) {} else { while (late) { function f() {} } } let late = 1; return "no throw " + late; });
show("a function under a var of its name", () => { var f; if (typeof late) {} else { function f() {} } let late = 1; return "no throw " + late; });
show("a function under a parameter of its name", f => { if (typeof late) {} else { function f() {} } let late = 1; return "no throw " + late; });
show("a function whose own body is strict", () => { if (typeof late) {} else { function f() { "use strict"; } } let late = 1; return "no throw " + late; });
show("an async function", () => { if (typeof late) {} else { async function f() {} } let late = 1; return "no throw " + late; });
show("a generator", () => { if (typeof late) {} else { function* f() {} } let late = 1; return "no throw " + late; });
show("a var", () => { if (typeof late) {} else { var v = 1; } let late = 1; return "no throw " + late + v; });
show("a var in the head of a loop", () => { if (typeof late) {} else { for (var i = 0; i < 1; i++) {} } let late = 1; return "no throw " + late; });
show("a switch", () => { if (typeof late) {} else { switch (0) {} } let late = 1; return "no throw " + late; });
show("a with", () => { if (typeof late) {} else { with ({}) {} } let late = 1; return "no throw " + late; });
show("a test with a call", () => { if (late === count()) { function f() {} } let late = 1; return "no throw " + late; });
show("a function beside a direct eval in strict code", () => { "use strict"; if (typeof late) {} else { function f() {} eval(""); } let late = 1; return "no throw " + late; });
show("a function in strict code", () => { "use strict"; if (typeof late) {} else { function f() {} } let late = 1; return "no throw " + late; });
show("a function in a class", () => new (class { m() { if (typeof late) {} else { function f() {} } let late = 1; return "no throw " + late; } })().m());
show("a function under a let of its name", () => { let f; if (typeof late) {} else { function f() {} } let late = 1; return "no throw " + late + f; });
show("a function under a function of a block of its name", () => { { function f() {} if (typeof late) {} else { function f() {} } } let late = 1; return "no throw " + late; });
show("a function named arguments", () => (function () { if (typeof late) {} else { function arguments() {} } let late = 1; return "no throw " + late; })());
show("a let, a const and a class", () => { if (typeof late) {} else { let v = 1; const w = 2; class C {} } let late = 1; return "no throw " + late; });
show("a var that binds no name", () => { if (typeof late) {} else { var [] = [], {} = {}; } let late = 1; return "no throw " + late; });
show("calls and a return", () => { if (typeof late) {} else { count(); return count(); } let late = 1; return "no throw " + late; });
show("a not of a list", () => { if (![late]) { function f() {} } let late = 1; return "no throw " + late; });
show("a not of a typeof", () => { if (!typeof late) { function f() {} } let late = 1; return "no throw " + late; });
show("two nots of a list", () => { if (!![late]) {} else { function f() {} } let late = 1; return "no throw " + late; });
show("a not of a list in front of a comma", () => { if ((![late], 0)) { function f() {} } let late = 1; return "no throw " + late; });
show("a void", () => { if (void late) { function f() {} } let late = 1; return "no throw " + late; });
show("a not of a list with a call", () => { if (![late, count()]) { function f() {} } let late = 1; return "no throw " + late; });
show("initialized by then", () => { let late = 1; if (typeof late) {} else { function f() {} } return "no throw " + late; });
console.log("calls: " + calls);
