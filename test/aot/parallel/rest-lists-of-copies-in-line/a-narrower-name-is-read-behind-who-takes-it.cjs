// In an arm of a switch over the length the list is handed on and an element read behind the call: the change is seen.
function change(list) { list[0] = "changed"; return list.length; }
function fire(...args) { switch (args.length) { case 1: return "one" + args[0]; case 2: { const got = change(args); return got + ":" + args[0] + ":" + args[1]; } default: return "more"; } }
const upTo = JSON.parse("[0,1,2,3,4,5,6,7,8]");
function run(turn) { let text = ""; for (let i = 0; i < upTo[3]; i++) text += "|" + fire(turn, i) + "|" + fire(i); return text; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
