// Under: --aot-check=Validate: the verifier refused the length given to the maker of a view where it is the length of a list: a right program did not build
function show(view) { return view.length + ":" + Array.prototype.join.call(view); }
const rounds = +process.argv[2] || 3;
function heights(towers, others) { const many = towers.length; const rest = new Uint32Array(others.length); const tall = new Uint32Array(many); for (let place = 0; place < many; place++) { const tower = towers[place]; rest[place] = tower % 8; tall[place] = tower >>> 2; } return [tall, rest]; }
for (let r = 0; r < rounds; r++) { const made = heights([9, 17, 33, 65 + r, 129], [1, 2]); console.log(show(made[0]), show(made[1])); }
