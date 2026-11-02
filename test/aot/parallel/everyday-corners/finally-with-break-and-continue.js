// Finally with break and continue: compiled answers as plain.
function f() {
  const out = [];
  for (let i = 0; i < 4; i++) {
    try {
      if (i === 1) continue;
      if (i === 2) break;
      out.push("t" + i);
    } finally {
      out.push("f" + i);
    }
  }
  return out.join();
}
console.log(f());
