// Text that is evaluated in a function of the file names the variables of the file, and finds the dead zone and the one function that compiled code finds.
function ask(text) { try { return eval(text); } catch (e) { return e.name; } }
const early = [ask("typeof arrow"), ask("typeof pattern"), ask("typeof table")].join();
const arrow = x => x + 1;
const pattern = /p/g;
const table = { a: 1 };
const readArrow = () => arrow;
const readPattern = () => pattern;
const readTable = () => table;
console.log(early);
console.log(ask("arrow") === readArrow(), ask("arrow(2)"), ask("arrow") === ask("arrow"), ask("arrow.name"));
console.log(ask("pattern") === readPattern(), ask("table") === readTable(), ask("table.a"));
