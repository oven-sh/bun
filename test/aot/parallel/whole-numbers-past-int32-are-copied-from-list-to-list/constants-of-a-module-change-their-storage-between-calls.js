// STATISTIC: LoopsBoughtOnceMoreForListsOfAnotherKindOfStorage >= 1
// Under: --aot-harden=proof-checks: the kind found in front of the turns is held against the cell at every access
"use strict";
const rounds = +process.argv[2] || 3; const said = [];
const show = l => Array.from(l, x => Object.is(x, -0) ? "-0" : String(x)).join(" ") + "#" + l.length + "#" + Object.keys(l).length;
const N = 24, a = new Array(N), b = new Array(N), c = new Array(N); for (let i = 0; i < N; i++) { a[i] = i; b[i] = i * 2; if (i !== 6) c[i] = i * 5; }
function f(t) { for (let i = 0; i < N; i++) b[N - 1 - i] = a[i]; return b[t % N]; }
function g(t) { for (let i = 0; i < N; i++) c[N - 1 - i] = a[i]; return c[t % N]; }
for (let t = 0; t < rounds; t++) { said.length = 0;
  said.push(f(1), show(b)); a[7] = 1762400000000; said.push(f(2), show(b)); b[0] = 8589934592; said.push(f(3), show(b)); a[5] = -0; said.push(f(5), show(b)); said.push(g(6), show(c));
  for (let i = 0; i < N; i++) a[i] = 9007199254740991 - i; said.push(f(9), show(b), g(10), show(c)); for (let i = 0; i < N; i++) a[i] = i; said.push(f(11), show(b), g(12), show(c)); }
console.log(said.join("\n"));
