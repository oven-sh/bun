// The console comes back out of a reviver of JSON.parse, so the compiler does not know what the stores go to, and no other store names these members. An executable throws a TypeError that names the first of them, where `bun run` stores.
// Alone: what it prints depends on what else the executable holds: a member of console that another entry point assigns can be assigned here too
const print = console.log.bind(console);
const calls = [];
const replacementFor = name => (...values) => { calls.push(name + "(" + values.join() + ")"); };
const bag = { target: console };
const con = JSON.parse(`{"key":"target"}`, function (key, value) { return key === "key" ? bag[value] : value; }).key;
function install(object, names) { for (const name of names) object[name] = replacementFor(name); }
install(con, ["log", "countReset", "groupEnd", "timeLog", "table", "warn", "assert", "dirxml"]);
console.log(1); console.countReset(2); console.groupEnd(3); console.timeLog(4); console.table(5); console.warn(6); console.assert(7); console.dirxml(8);
print(calls.join(" "));
/* Output:
exit code 1
TypeError: Cannot assign to console.log because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
*/
