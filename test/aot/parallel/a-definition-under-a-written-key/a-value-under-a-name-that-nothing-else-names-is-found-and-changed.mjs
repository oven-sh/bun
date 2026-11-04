class P { v = 1; }
const o = { a: 1 };
const p = new P;
function act() { Object.defineProperty(o, "hiddenName", { value: p, enumerable: true }); }
act();
const found = Object.values(o).pop();
found.v = "text";
console.log(typeof p.v, found === p);
