const log = [];
function three(a, b, c) { return "[" + a + b + c + "]"; }
function self(xs) { let r = 0; for (let i = 0; i < 2; i++) r = xs.push(...xs); return r + ":" + xs.join(""); }
function joined(xs) { let r = []; for (let i = 0; i < 2; i++) r = xs.concat(...xs); return r.join(""); }
const holder = { list: JSON.parse("[1,2]"), get m() { log.push("read"); this.list.push(9); return function (a, b, c) { return this === holder ? "" + a + b + c : "lost"; }; } };
function getter(h) { let s = ""; for (let i = 0; i < 2; i++) s += h.m(...h.list) + ","; return s; }
function mixed(ls) { let s = "", done = 0; for (let i = 0; i < ls.length; i++) { const xs = ls[i]; s += three(...xs); done++; } return s + done; }
function maybe(f, ls) { let s = ""; for (let i = 0; i < ls.length; i++) s += f?.(...ls[i]) + ","; return s; }
const ls = JSON.parse('[[1,2,3],"xyz",[4]]'); ls.splice(2, 0, new Set("pq"));
console.log(`SAID ${self(JSON.parse("[1,2]"))} ${joined(JSON.parse("[[1],[2]]"))} ${getter(holder)} ${log.length} ${mixed(ls)} ${maybe(three, ls)} ${maybe(undefined, ls)}`);
