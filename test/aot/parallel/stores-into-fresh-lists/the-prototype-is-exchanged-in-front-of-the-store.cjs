// The prototype is exchanged for an object with a setter under an index: the store into the hole calls it.
const upTo = JSON.parse("[0,1,2,3,4,5,6]");
const data = JSON.parse('[{"x":3},{"x":"four"},{"x":5.5},{"x":null}]');
function show(list) { let text = list.length + "["; for (let i = 0; i < list.length && i < 9; i++) text += (i in list ? String(list[i]) : "-") + ","; return text + "]" + Object.keys(list).length; }
let seen = "";
function make(a) { const list = new Array(2); Object.setPrototypeOf(list, { set 1(value) { seen += "<" + value + ">"; }, get 1() { return "above"; } }); list[0] = a; list[1] = a; return list[0] + ":" + list[1] + ":" + (Object.keys(list).length) + seen.length; }
function run(turn) { let text = ""; for (let i = 0; i < upTo[4]; i++) text += "|" + make(data[i].x, i, turn); return text; }
globalThis.handed = [run, show];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
