// Under: --aot-check=Validate: the verifier refused the length given to the maker of a view where it is the length of a list: a right program did not build
function show(view) { return view.length + ":" + Array.prototype.join.call(view); }
const rounds = +process.argv[2] || 3;
function take(view, i) { if (i == 2) structuredClone(view.buffer, { transfer: [view.buffer] }); return i; }
function split(lst) { const len = lst.length; const high = new Uint32Array(len); for (let i = 0; i < len; i++) { high[take(high, i)] = lst[i] >>> 3; high[i] = high[i] + 1; } return high; }
for (let r = 0; r < rounds; r++) console.log(show(split([9, 17, 33, 65 + r, 129, 257])));
