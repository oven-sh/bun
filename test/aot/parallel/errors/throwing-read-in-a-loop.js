function caught(e) { return e instanceof Error && e.message.startsWith("fail ") ? e.message : "threw " + typeof e; }
function f(L) {
  let z = 0;
  for (let i = 0; i < L.length; i++) {
    try { L[i].x.y; } catch (err) { z++; }
  }
  return z;
}
let r;
try { r = f([[[1]], {}]); } catch (e) { r = caught(e); }
console.log(r);
console.log(Array.from({ length: 3 }).length);

