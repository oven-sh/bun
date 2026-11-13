// fire(name, ...args) reads the length and the elements of its rest list where one handler is found, and hands the list on, last of all, where several are.
// STATISTIC: RestArrayAllocationsSunk >= 1
const table = { one: (a, b) => "one" + a + b, many: [(a, b) => "x" + a, (a, b) => "y" + b] };
const names = JSON.parse('["one","many","none"]');
function each(list, args) { let text = ""; for (let i = 0; i < list.length; i++) text += list[i].apply(undefined, args); return text + "/" + args.length; }
function fire(name, ...args) { const found = table[name]; if (found === undefined) return "none"; if (typeof found === "function") { switch (args.length) { case 0: return found(); case 1: return found(args[0]); default: return found(args[0], args[1]); } } return each(found, args); }
const upTo = JSON.parse("[0,1,2,3,4,5,6,7,8]");
function run(turn) { let text = ""; for (let i = 0; i < upTo[6]; i++) text += ":" + fire(names[i % 3], turn, i); return text; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
