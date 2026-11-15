// Under: --aot-check=Validate: the verifier refused the length given to the maker of a view where it is the length of a list: a right program did not build
const rounds = +process.argv[2] || 3;
function sum(views) { let all = 0; for (const view of views) for (let i = 0; i < view.length; i++) all = (all * 31 + view[i]) >>> 0; return all; }
function split(lst) { const len = lst.length; const high = new Uint32Array(len), low = new Uint32Array(len); for (let i = 0; i < len; i++) { high[i] = lst[i] >>> 3; low[i] = lst[i] & 7; } return [high, low]; }
for (let r = 0; r < rounds; r++) { const all = []; for (let k = 0; k < 400; k++) { const guard = new Uint32Array(8).fill(0xa5a5a5a5); all.push(guard, ...split([9, 17, 33, 65 + r, 129 + k, 257, 513]), new Uint32Array(8).fill(0x5a5a5a5a)); } console.log(sum(all), all.length); }
