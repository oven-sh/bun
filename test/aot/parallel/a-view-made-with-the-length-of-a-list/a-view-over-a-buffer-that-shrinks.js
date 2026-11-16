// Under: --aot-check=Validate: the verifier refused the length given to the maker of a view where it is the length of a list: a right program did not build
function show(view) { return view.length + ":" + Array.prototype.join.call(view); }
const rounds = +process.argv[2] || 3;
function split(lst, at) { const len = lst.length; const buffer = new ArrayBuffer(len * 4, { maxByteLength: len * 8 }); const high = new Uint32Array(buffer); for (let i = 0; i < len; i++) { high[i] = lst[i] >>> 3; if (i == at) buffer.resize(8); } return high; }
for (let r = 0; r < rounds; r++) for (const at of [2, 99]) console.log(show(split([9, 17, 33, 65 + r, 129, 257], at)));
