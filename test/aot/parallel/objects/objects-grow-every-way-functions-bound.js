// Who makes Structures, and who binds: each way once or a few times, for the counts.
function bindMany(f, n) { const out = []; for (let i = 0; i < n; i++) out.push(f.bind(null, i)); return out; }
function addNames(n) { const o = {}; for (let i = 0; i < n; i++) o["k" + i] = i; return o; }
function withPrototype(p) { return Object.create(p); }
function makeClass(i) { return class { a() { return i; } b() { return i + 1; } }; }
const bound = bindMany(function add(a, b) { return a + b; }, 50);
const names = addNames(30);
const big = addNames(200);
const protos = []; for (let i = 0; i < 10; i++) protos.push(withPrototype({ i }));
const classes = []; for (let i = 0; i < 5; i++) classes.push(makeClass(i));
const entries = Object.fromEntries([["x", 1], ["y", 2], ["z", 3]]);
delete names.k3;
Object.freeze(entries);
console.log(bound[7](1), Object.keys(names).length, Object.keys(big).length, protos.length, new classes[2]().b(), entries.z);
