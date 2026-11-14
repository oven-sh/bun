class A { constructor(a, b = 5, ...rest) { this.n = arguments.length; this.a = a; this.b = b; this.rest = rest.length; } }
class B extends A { }
class Two { constructor(a, b) { this.a = a; this.b = b; } }
class Below extends Two { }
class None { constructor() { this.n = arguments.length; } }
class Under extends None { }
globalThis.kept = [A, B, Two, Below, None, Under];
function say(o) { return [o.n, o.a, o.b, o.rest].join("/"); }
function run(n) { let last = "", t = 0; for (let i = 0; i < n; i++) { last = say(new B()) + " " + say(new B(i)) + " " + say(new B(i, undefined)) + " " + say(new B(i, 2, 3, 4, 5, 6, 7, 8, 9)) + " " + say(new Below()) + " " + say(new Below(i)) + " " + say(new Below(i, 2, 3)) + " " + say(new Under(1, 2, 3)); t += last.length; } return last + " " + t; }
console.log(run(10000));
const unseen = (0, eval)("(function (K, n) { let t = ''; for (let i = 0; i < n; i++) { const list = []; for (let j = 0; j < i % 7; j++) list.push(j); const o = new K(...list); t = [o.n, o.a, o.b, o.rest].join('/') + ' ' + (i % 7 ? '' : t.slice(0, 60)); } return t; })");
for (const K of globalThis.kept) console.log(unseen(K, 5000));
try { new Below(...new Array(400000).fill(1)); console.log("made"); } catch (e) { console.log(e.constructor.name); }
