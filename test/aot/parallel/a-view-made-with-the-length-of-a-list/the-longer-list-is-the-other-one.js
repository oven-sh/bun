// Under: --aot-check=Validate: the verifier refused the length given to the maker of a view where it is the length of a list: a right program did not build
const rounds = +process.argv[2] || 3;
function sum(views) { let all = 0; for (const view of views) for (let i = 0; i < view.length; i++) all = (all * 31 + view[i]) >>> 0; return all; }
function split(lst, other) { const len = other.length; const front = new Uint32Array(4).fill(0xa5a5a5a5), high = new Uint32Array(lst.length), behind = new Uint32Array(4).fill(0x5a5a5a5a); for (let i = 0; i < len; i++) high[i] = other[i] | 0x80000000; return [front, high, behind]; }
for (let r = 0; r < rounds; r++) { const all = []; for (let k = 0; k < 400; k++) all.push(...split([1, 2], [9, 17, 33, 65 + r, 129 + k, 257, 513, 1025, 2049, 4097, 8193, 16385])); console.log(sum(all), all.length); }
