// A literal of one to four values, filled by the loop behind it to every length from nothing to thirty-four and then past the greatest room that one cell bears: by push, by a store under the counter; then cut, grown by its length, and stored into behind a gap. What is printed is what plain Bun prints.
"use strict";
const seed = JSON.parse('["a", 2, 3.5, null]');
function one(n) { const list = [seed[0]]; for (let i = 0; i < n; i++) list.push(i); return list; }
function two(n) { const list = [seed[0], seed[1]]; for (let i = 0; i < n; i++) list.push(i + 0.5); return list; }
function four(n) { const list = [seed[0], seed[1], seed[2], seed[3]]; for (let i = 0; i < n; i++) list.push({ i }); return list; }
function stored(n) { const list = [seed[1]]; for (let i = 1; i <= n; i++) list[i] = i * 2; return list; }
function cut(n) { const list = [seed[1]]; for (let i = 0; i < n; i++) list.push(i); list.length = 1; list.length = 3; return list; }
function gap(n) { const list = [seed[1]]; for (let i = 0; i < n; i++) list.push(i); list[n + 2] = "x"; return list; }
function twice(n) { const list = [seed[0]]; for (let i = 0; i < n; i++) { list.push(i); list.push(-i); } return list; }
function fromThree(n) { const list = [seed[0], seed[1]]; for (let i = 3; i < n; i++) list.push(i); return list; }
function upTo(n) { const list = [seed[0]]; for (let i = 1; i <= n; i++) list.push(i); return list; }
function show(name, n, list) { console.log(name, n, list.length, JSON.stringify(list), Object.keys(list).length, list.indexOf(undefined), list.includes(undefined)); }
for (let n = 0; n <= 140; n += n < 34 ? 1 : 31) {
  show("one", n, one(n));
  show("two", n, two(n));
  show("four", n, four(n));
  show("stored", n, stored(n));
  show("cut", n, cut(n));
  show("gap", n, gap(n));
  show("twice", n, twice(n));
  show("fromThree", n, fromThree(n));
  show("upTo", n, upTo(n));
  const grown = one(0);
  grown.length = 2 + (n & 7);
  show("grown", n, grown);
}
