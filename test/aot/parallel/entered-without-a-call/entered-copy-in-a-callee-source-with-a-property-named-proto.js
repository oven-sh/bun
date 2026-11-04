// A callee spreads an object that has a property of its own under the name __proto__: the copy defines it, so what stands above the new object stays, and the caller looks at what a name finds through the copy.
function make() { return JSON.parse('{"a":1,"__proto__":{"x":5}}'); }
function plain() { return { a: 1 }; }
function middle(s) { return { ...s }; }
function outer(s) { const copy = middle(s); return copy.a + ":" + String(copy.x) + ":" + (Object.getPrototypeOf(copy) === Object.prototype) + ":" + Object.hasOwn(copy, "__proto__"); }
function looped(s) { let t = ""; for (let i = 0; i < 3; i++) t += String(middle(s).x) + ","; return t; }
console.log(outer(plain()), outer(make()), looped(make()));
