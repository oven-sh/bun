// Under: --aot-check=Validate: the verifier refused the length given to the maker of a view where it is the length of a list: a right program did not build
function show(view) { return view.length + ":" + Array.prototype.join.call(view); }
const rounds = +process.argv[2] || 3;
function split(lst) { const high = new Uint32Array(lst.length); for (let i = 0; i < lst.length; i++) { high[i] = lst[i] >>> 3; if (i < 40 && (i & 1)) lst.push(i * 8 + 8); } return high; }
for (let r = 0; r < rounds; r++) { const lst = [9, 17, 33, 65 + r, 129]; console.log(show(split(lst)), lst.length); }
