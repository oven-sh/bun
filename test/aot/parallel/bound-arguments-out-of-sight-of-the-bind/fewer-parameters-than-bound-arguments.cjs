function count(a) { return arguments.length * 10 + a; }
function rest(...all) { return all.length * 100 + all[0]; }
const two = count.bind(null, 1, 2), three = rest.bind(null, 1, 2, 3);
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) s = (s + two(i) + three(i, i)) | 0; return s; }
console.log(drive(+(process.argv[2] ?? 50)));
