// Closures that are lent, one probe of many. It prints what plain Bun prints.
const data = JSON.parse(process.argv[2] ?? '{"a":[1,2,3,4,5,6,7,8],"b":{"c":[3,1,2]}}');
const env = JSON.parse(process.argv[3] ?? '{"x":0,"3":1}');
function tailSome(o) { return o.a.some(v => env[v]); }
function plainSome(o) { if (o.a.some(v => env[v])) return 1; return 0; }
function findIt(o) { const d = o.a?.find(v => v === 3 || v === 4); if (d === undefined) return -1; return d; }
let total = 0;
for (let i = 0; i < 2000; i++) total += (tailSome(data) ? 1 : 0) + plainSome(data) + findIt(data);
console.log(total);
