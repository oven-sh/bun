// The console comes back out of a reviver of JSON.parse, so the compiler does not know what the stores go to. Each store names a member of console, so it replaces that member as under bun run.
const print = console.log.bind(console);
const calls = [];
const replacementFor = name => (...values) => { calls.push(name + "(" + values.join() + ")"); };
const bag = { target: console };
const con = JSON.parse(`{"key":"target"}`, function (key, value) { return key === "key" ? bag[value] : value; }).key;
function install(object, names) { for (const name of names) object[name] = replacementFor(name); }
install(con, ["log", "countReset", "groupEnd", "timeLog", "table", "warn", "assert", "dirxml"]);
console.log(1); console.countReset(2); console.groupEnd(3); console.timeLog(4); console.table(5); console.warn(6); console.assert(7); console.dirxml(8);
print(calls.join(" "));
