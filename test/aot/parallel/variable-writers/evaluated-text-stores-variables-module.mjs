// Text handed to a direct eval assigns the variables, exports, functions and static fields of the module around the call.
let x = 1; const g = () => x;
eval("x = 2"); console.log(g());
function f(s) { return eval(s); } f("x = 3"); console.log(g());
export let y = 1; const gy = () => y; f("y = 4"); console.log(gy());
function h() { let z = 1; const r = () => z; eval("z = 5"); return r(); } console.log(h());
class A { static s = 1; static read() { return A.s; } } f("A.s = 6"); console.log(A.read());
const k = 1; try { f("k = 2"); } catch (e) { console.log(e.name, k); }
function decl() { return 1; } const call = () => decl(); f("decl = () => 7"); console.log(call());
let never; const rn = () => never; console.log(rn()); f("never = 8"); console.log(rn());
let once; once = 1; const ro = () => once; f("once = 9"); console.log(ro());
console.log(f("var inner = 10; inner"), typeof inner);
