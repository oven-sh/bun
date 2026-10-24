// Every assignment in compiled code to a member of console works, and a later call runs what was stored. Here the compiler knows neither what the stores go to nor under which names.
const print = console.log.bind(console);
const calls = [];
const replacementFor = name => (...values) => { calls.push(name + "(" + values.join() + ")"); };
const bag = { target: console };
const con = JSON.parse(`{"key":"target"}`, function (key, value) { return key === "key" ? bag[value] : value; }).key;
function install(object, names) { for (const name of names) object[name] = replacementFor(name); }
install(con, Object.keys(con));
console.log(1); console.countReset(2); console.groupEnd(3); console.timeLog(4); console.table(5); console.warn(6); console.assert(7); console.dirxml(8);
print(calls.join(" "));
