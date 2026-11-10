// Under: --aot-check=Validate: the verifier refused the length given to the maker of a view where it is the length of a list: a right program did not build
function show(view) { return view.length + ":" + Array.prototype.join.call(view); }
const rounds = +process.argv[2] || 3;
function split(lst) { const len = lst.length; const high = new Uint32Array(len), low = new Uint32Array(len); for (let i = 0; i < len; i++) { high[i] = lst[i] >>> 3; low[i] = lst[i] & 7; } return [high, low]; }
for (let r = 0; r < rounds; r++) { const made = split([9, 17, 33, 65 + r, 129]); console.log(show(made[0]), show(made[1])); }
