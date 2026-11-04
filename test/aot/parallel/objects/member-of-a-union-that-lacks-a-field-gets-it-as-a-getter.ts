// `n.parent` is read through a union of which one member lacks the field. An object of that member gets the property all the same, as a getter that a descriptor defines
type A = { x: number; parent: string; y: number };
type B = { p: number; q: number };
function parentOf(n: A | B) { return (n as A).parent; }
function makeA(i: number): A { return { x: i, parent: "a" + i, y: i }; }
function makeB(i: number): B { return { p: i, q: i }; }
let ran = 0;
function deed(b: B) { Object.defineProperty(b, "parent", { get() { ran++; return "got" + ran; }, configurable: true }); return b; }
let out = "";
for (let i = 0; i < 3; i++) out += String(parentOf(makeA(i))) + " " + String(parentOf(makeB(i))) + " ";
console.log(out);
const changed = deed(makeB(7));
console.log(String(parentOf(changed)), Object.keys(changed).join(), String(changed.p + changed.q), JSON.stringify(changed));
let seen = "";
for (let turn = 0; turn < 300; turn++) seen = String(parentOf(turn % 3 ? makeB(turn) : deed(makeB(turn)))) + seen.slice(0, 24);
console.log(seen, String(ran));
