// Under: --aot-harden=proof-checks: the copy writes the elements of a view and nothing else
// Two functions in turn under a name that nothing declares: the first copies the elements of one view to another, or fills one.
const all = new Float32Array(32);
for (let i = 0; i < 32; i++) all[i] = i;
function copy(to, from, n) { for (let i = 0; i < n; i++) to[i] = from[i]; }
function fill(to, from, n) { for (let i = 0; i < n; i++) to[i] = 7; }
function copyDown(to, from, n) { for (let i = n - 1; i >= 0; i--) to[i] = from[i]; }
function other(to, from, n) { return to.length + from.length; }
function both(first, n) { step = first; step(all.subarray(0, 8), all.subarray(8, 16), n); step = other; return step(all.subarray(0, 8), all.subarray(8, 16), n); }
for (const first of [copy, fill, copyDown]) { console.log(both(first, 4)); console.log(both(first, 6)); console.log(all.join()); }
