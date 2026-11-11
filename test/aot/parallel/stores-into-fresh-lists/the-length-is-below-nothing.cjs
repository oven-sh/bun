// A length below 0 throws.
const upTo = JSON.parse("[0,1,2,3,4,5,6]");
const data = JSON.parse('[{"x":3},{"x":"four"},{"x":5.5},{"x":null}]');
function show(list) { let text = list.length + "["; for (let i = 0; i < list.length && i < 9; i++) text += (i in list ? String(list[i]) : "-") + ","; return text + "]" + Object.keys(list).length; }
function make(a) { try { const list = new Array(-1); list[0] = a; return "made " + list.length; } catch (error) { return error.name + ":" + a; } }
function run(turn) { let text = ""; for (let i = 0; i < upTo[4]; i++) text += "|" + make(data[i].x, i, turn); return text; }
globalThis.handed = [run, show];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
