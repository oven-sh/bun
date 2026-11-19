const count = Number(process.argv[2] ?? 12);
let calls = 0;
const twist = (a, b) => ({ u: a.v * b.w - a.w * b.v, v: a.w * b.u - a.u * b.w, w: a.u * b.v - a.v * b.u });
const flat = (a, b) => a.u * b.u + a.v * b.v + a.w * b.w;
function walked(list, turn) { let sum = 0; for (let i = 1; i < list.length; i++) sum += flat(twist(list[i - 1], list[i]), list[(i + turn) % list.length]); return sum; }
const table = { walked };
const list = JSON.parse("[" + Array.from({ length: count }, (_, i) => `{"u":${i % 5},"v":${(i * 3) % 7},"w":${i % 4 + 0.5}}`).join() + "]");
for (let k = 0; k < 3; k++) { list[2] = 7; list[5] = "text"; console.log(k, table[process.argv.length > 99 ? "other" : "walked"](list, k), calls, list.length); }
