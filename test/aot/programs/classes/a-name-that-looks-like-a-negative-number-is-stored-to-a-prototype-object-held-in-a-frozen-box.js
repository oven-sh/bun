class Base {}
class A extends Base { m() { return 1; } }
const box = Object.freeze({ held: A.prototype });
box.held["-2"] = 4;
const a = new A();
function read(o, k) { return o[k]; }
console.log("instance", a["-2"], read(a, "-2"), "-2" in a, A.prototype["-2"], Object.keys(A.prototype).join(), Reflect.ownKeys(A.prototype).join());
const seen = []; for (const k in a) seen.push(k); console.log("for-in", seen.join());
