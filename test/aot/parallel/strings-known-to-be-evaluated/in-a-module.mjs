const say = (...a) => console.log(...a.map(x => typeof x === "function" ? x.toString() : x));
export let count = 0;
const ops = ["+", "-"];
const made = {};
for (const op of ops) made[op] = eval("(function (a, b) { count++; return a " + op + " b; })");
say(made["+"](1, 2), made["-"](1, 2), count, made["+"]);
const f = eval("(function () { return this; })"); say(f());
const g = eval("(function () { return import.meta; })".replace("import.meta", "1")); say(g());
function inner() { return eval("(() => inner.name)")(); } say(inner());
