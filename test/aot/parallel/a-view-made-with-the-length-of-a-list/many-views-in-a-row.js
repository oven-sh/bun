// Under: --aot-check=Validate: the verifier refused the length given to the maker of a view where it is the length of a list: a right program did not build
const rounds = +process.argv[2] || 3;
function sum(views) { let all = 0; for (const view of views) for (let i = 0; i < view.length; i++) all = (all * 31 + view[i]) >>> 0; return all; }
function heights(towers) { const many = towers.length; const tall = new Uint32Array(many); for (let place = 0; place < many; place++) tall[place] = towers[place] >>> 2; const rest = new Uint32Array(many); let left = many; while (left > 0) { left--; rest[left] = towers[left] % 8 + (left ? tall[left - 1] : 0); } return [tall, rest]; }
for (let r = 0; r < rounds; r++) { const all = []; for (let k = 0; k < 400; k++) { const guard = new Uint32Array(8).fill(0xa5a5a5a5); all.push(guard, ...heights([9, 17, 33, 65 + r, 129 + k, 257, 513]), new Uint32Array(8).fill(0x5a5a5a5a)); } console.log(sum(all), all.length); }
