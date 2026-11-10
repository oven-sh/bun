// Under: --aot-check=Validate: the verifier refused the length given to the maker of a view where it is the length of a list: a right program did not build
function show(view) { return view.length + ":" + Array.prototype.join.call(view); }
const rounds = +process.argv[2] || 3;
function split(lst) { const len = lst.length; const high = new Uint32Array(len); split.made = high; for (let i = 0; i < len; i++) high[i] = lst[i] >>> 3; return high; }
for (let r = 0; r < rounds; r++) { const lst = [9, 17, { valueOf() { structuredClone(split.made.buffer, { transfer: [split.made.buffer] }); return 33; } }, 65 + r, 129, 257, 513, 1025]; console.log(show(split(lst))); }
