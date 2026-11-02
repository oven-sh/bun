// Every assignment in compiled code to a member of console works, and a later call runs what was stored. Here forty names come from an array literal, some of them new to console.
const print = console.log.bind(console);
const calls = [];
const replacementFor = name => (...values) => { calls.push(name + "(" + values.join() + ")"); };
const forty = ["assert", "clear", "count", "countReset", "debug", "dir", "dirxml", "error", "group", "groupCollapsed", "groupEnd", "info", "log", "profile", "profileEnd", "record", "recordEnd", "screenshot", "table", "takeHeapSnapshot", "time", "timeEnd", "timeLog", "timeStamp", "trace", "warn", "write", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen"];
for (const name of forty) console[name] = replacementFor(name);
console.thirteen(0); console.write(0);
console.log(1); console.countReset(2); console.groupEnd(3); console.timeLog(4); console.table(5); console.warn(6); console.assert(7); console.dirxml(8);
print(calls.join(" "));
