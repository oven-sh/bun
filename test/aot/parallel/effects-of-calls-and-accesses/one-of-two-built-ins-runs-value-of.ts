// what is called is one of two built-ins, and its operand is an object whose valueOf writes a field that the caller reads on both sides
class Box { x = 1; valueOf() { this.x = this.x + 1; return 2.5; } }
function deed(up: boolean, value: any, box: Box) { const before = box.x; const f = up ? Math.ceil : Math.floor; const got = f(value); return before + " " + got + " " + box.x; }
const box = new Box();
console.log(deed(true, 1.5, box));
console.log(deed(true, box, box));
console.log(deed(false, box, box));
let all = "";
for (let i = 0; i < 4; i++) all += deed(i % 2 === 0, i % 2 ? box : i + 0.5, box) + ";";
console.log(all);
