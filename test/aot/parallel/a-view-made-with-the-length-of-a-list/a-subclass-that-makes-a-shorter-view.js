// Under: --aot-check=Validate: the verifier refused the length given to the maker of a view where it is the length of a list: a right program did not build
function show(view) { return view.length + ":" + Array.prototype.join.call(view); }
const rounds = +process.argv[2] || 3;
class Short extends Uint32Array { constructor(length) { super(length >> 1); } }
function split(lst, Maker) { const len = lst.length; const high = new Maker(len); for (let i = 0; i < len; i++) high[i] = lst[i] >>> 3; return high; }
for (let r = 0; r < rounds; r++) console.log(show(split([9, 17, 33, 65 + r, 129, 257], Uint32Array)), show(split([9, 17, 33, 65 + r, 129, 257], Short)));
