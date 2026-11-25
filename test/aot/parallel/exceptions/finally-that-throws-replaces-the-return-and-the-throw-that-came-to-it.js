// a finally block throws on some runs, and replaces the return or the throw that has come to it
let fails = 0;
const lock = { release() { fails++; if (fails % 4 === 0) throw new Error("release " + fails); } };
function subject(early) {
  try {
    if (early === 1) return "returned";
    if (early === 2) throw new Error("thrown");
  } finally {
    lock.release();
  }
  return "ended";
}
function deed(early) { try { return subject(early); } catch (e) { return e.message; } }
console.log(deed(0), deed(1), deed(2), deed(0), deed(1), deed(2), deed(0), deed(1), deed(2));
let out = 0;
for (let i = 0; i < 300; i++) out += deed(i % 3).length;
console.log(String(out), String(fails));
lock.release = function () { throw "late"; };
try { console.log(subject(JSON.parse("1"))); } catch (e) { console.log(String(e)); }
