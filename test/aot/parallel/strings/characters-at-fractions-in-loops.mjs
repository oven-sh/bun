// A position that is proven to be a fraction, though its value is unknown, is truncated in a loop that does not change it.
const times = Reflect.apply(v => v, undefined, [3]);
function code(x) { let last; for (let t = 0; t < times; t++) last = "abcd".charCodeAt(x); return last; }
function point(x) { let last; for (let t = 0; t < times; t++) last = "abcd".codePointAt(x); return last; }
function at(x) { let last; for (let t = 0; t < times; t++) last = "abcd".at(x); return last; }
function atEnd(x) { let last; for (let t = 0; t < times; t++) last = "abcd".at(x); return last; }
function char(x) { let last; for (let t = 0; t < times; t++) last = "abcd".charAt(x); return last; }
function element(x) { let last; for (let t = 0; t < times; t++) last = "abcd"[x]; return last; }
function outside(x) { let last; for (let t = 0; t < times; t++) last = "abcd".charCodeAt(x); return last; }
function before(x) { let last; for (let t = 0; t < times; t++) last = "abcd".codePointAt(x); return last; }
console.log(code(Reflect.apply(v => v, undefined, [0.5])), point(Reflect.apply(v => v, undefined, [1.5])), at(Reflect.apply(v => v, undefined, [2.9])));
console.log(atEnd(Reflect.apply(v => v, undefined, [-1.5])), char(Reflect.apply(v => v, undefined, [3.1])), element(Reflect.apply(v => v, undefined, [0.5])));
console.log(outside(Reflect.apply(v => v, undefined, [4.5])), before(Reflect.apply(v => v, undefined, [-0.5])));
