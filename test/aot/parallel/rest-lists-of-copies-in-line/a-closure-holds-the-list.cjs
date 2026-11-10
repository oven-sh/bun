// A closure of the function reads the list later; who takes the list has changed it by then.
function change(list) { list.push("more"); return list.length; }
const later = [];
function fire(flag, ...args) { later.push(() => args.length); if (!flag) return args.length; return change(args); }
const flags = JSON.parse("[true,false,true]");
const upTo = JSON.parse("[0,1,2,3,4,5,6,7,8]");
function run(turn) { let sum = 0; for (let i = 0; i < upTo[3]; i++) sum += fire(flags[i], turn, i); return sum; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
console.log(later.map(read => read()).join());
