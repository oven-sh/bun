function startsWhereFound(s, list, key) {
  let t = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] !== key) continue;
    if (s.startsWith("a")) t += 3;
    s = s.slice(1);
  }
  return s + "|" + t;
}
function matchesWhereFound(s, list, key) {
  let t = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === key) {
      const m = /^[a-c]+/.exec(s);
      if (m) t += m[0].length;
      s = s.slice(1);
    }
  }
  return s + "|" + t;
}
const texts = ["k0", "k1", "k2", "k3", "k4", "k0", "k0", "k1", "k3", "k0", "k0", "k3", "k1", "k2", "k0"];
for (const key of ["k0", "k3", "k9"]) {
  console.log(startsWhereFound("abcdabcdabcdabcdabcdabcdabcdabcd", texts, key));
  console.log(matchesWhereFound("abcdabcdabcdabcdabcdabcdabcdabcd", texts, key));
}
