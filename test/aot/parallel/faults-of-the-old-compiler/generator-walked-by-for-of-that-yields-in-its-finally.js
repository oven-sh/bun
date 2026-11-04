const N = Number(process.argv[2] ?? 0), L = [];
function* steps(a, limit) {
  let note = "";
  try {
    const p = a * 3;
    yield p;
    try { L.push(p); } finally { note += "i"; }
    if (limit > 2) note = "big";
  } finally { yield note; }
}
const A = N > 1e9 ? 2n : 2;
for (const v of steps(A, N)) L.push(v);
console.log(L.join());
