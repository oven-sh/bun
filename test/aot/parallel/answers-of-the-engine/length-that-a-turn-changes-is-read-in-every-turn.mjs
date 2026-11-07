// The length of a list that a turn makes longer or shorter: by push, pop, a store of length, a store behind the end, through another name, in a callee.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
function grows(a, most) { let c = 0; for (let i = 0;i < a.length && c < most; i++) { a.push(i); c++; } return c; }
function shrinks(a) { let c = 0; for (let i = 0;i < a.length; i++) { a.pop(); c++; } return c; }
function isCut(a) { let c = 0; for (let i = 0;i < a.length; i++) { a.length = a.length - 1; c++; } return c; }
function throughAlias(a, b) { let c = 0; for (let i = 0;i < a.length; i++) { b.pop(); c++; } return c; }
function byStore(a, most) { let c = 0; for (let i = 0;i < a.length && c < most; i++) { a[a.length] = i; c++; } return c; }
function byCallee(a, f) { let c = 0; for (let i = 0;i < a.length; i++) { f(a); c++; } return c; }
function inBody(a, n) { let s = 0; for (let i = 0;i < n; i++) { s += a.length; if (i & 1) a.push(i); } return s; }
function stays(a, n) { let s = 0; for (let i = 0;i < n; i++) { s += a.length; a[0] = i; } return s; }
function nested(a, n) { let s = 0; for (let i = 0;i < n; i++) { for (let j = 0;j < n; j++) s += a.length; a.push(i); } return s; }
function view(a, n) { let s = 0; for (let i = 0;i < n; i++) { s += a.length; a[i] = i; } return s; }
function text(t, n) { let s = 0; for (let i = 0;i < n; i++) { s += t.length; t = t + "!"; } return s; }
report(grows([1], 5));
report(shrinks([1, 2, 3, 4, 5]));
report(isCut([1, 2, 3, 4, 5, 6]));
const both = [1, 2, 3, 4, 5, 6, 7];
report(throughAlias(both, both));
report(throughAlias([1, 2, 3], [1, 2, 3]));
report(byStore([1], 4));
report(byCallee([1, 2, 3, 4], (a) => { a.pop(); }));
report(byCallee([1, 2, 3, 4], () => {}));
report(inBody([1], 6));
report(stays([1, 2], 4));
report(nested([1], 3));
report(view(new Int32Array(3), 5));
report(text("ab", 4));
report("end");
