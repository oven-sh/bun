// Every assignment in compiled code to a member of console works, and a later call runs what was stored. Here the names are those that Object.keys(console) lists: nobody can enumerate them when the program is built.
const print = console.log.bind(console);
const calls = [];
const replacementFor = name => (...values) => { calls.push(name + "(" + values.join() + ")"); };
for (const name of Object.keys(console)) console[name] = replacementFor(name);
console.log(1); console.countReset(2); console.groupEnd(3); console.timeLog(4); console.table(5); console.warn(6); console.assert(7); console.dirxml(8);
print(calls.join(" "));
