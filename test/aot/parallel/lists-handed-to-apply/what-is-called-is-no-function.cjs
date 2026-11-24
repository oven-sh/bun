// What stands in the place of the function is undefined, null, a number, and an object below Function.prototype that cannot be called: the error is the one of plain Bun.
const others = [undefined, null, 5, Object.create(Function.prototype), { apply: 7 }];
const wrap = fn => function (...args) { return fn.apply(this, args); };
function run(turn) { let text = ""; for (let i = 0; i < others.length; i++) { try { text += ":" + wrap(others[i])(turn, i); } catch (error) { text += ":" + error.name + " " + error.message; } } return text; }
globalThis.handed = [run];
for (let turn = 0; turn < 2; turn++) console.log(run(turn));
