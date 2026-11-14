const z = JSON.parse("0");
const options = JSON.parse('{"skip":false}');
const limit = JSON.parse("7");
function kept(s, n) {
  let t = "", out = "";
  for (let i = 0; i < 10; i++) {
    if (z) continue;
    if (s[i] === "b") out += t[n] ?? "?";
    if (s.length > 12) s = s.slice(-11);
    t += s.charCodeAt(0);
  }
  return out + "|" + s + "|" + t;
}
function countedDown(s) {
  let out = "";
  for (let i = 10; i > 0; i--) {
    if (options.skip) continue;
    const m = /^[a-c]+/.exec(s);
    if (m) out += m[0] + ",";
    if (s.length > 2) s = s.slice(1);
  }
  return out + s;
}
function whileLonger(s) {
  let r = 0, i = 0;
  while (i < 25) {
    i++;
    if (z) continue;
    if (s.length > limit) s = s.slice(2);
    r = (r * 31 + s.charCodeAt(0)) | 0;
  }
  return s + "|" + r;
}
function sometimes(s) {
  let r = 0;
  for (let i = 0; i < 30; i++) {
    if (i % 5 === 3) continue;
    if (s.startsWith("a")) s = s.slice(1);
    else if (s.length > 6) s = s.slice(3);
    r += s.length;
  }
  return s + "|" + r;
}
for (const text of ["abc1 de23, fabc1 de23, f", "abcabcabcabcabcabcabcabc", "zabc"]) {
  const made = JSON.parse(JSON.stringify(text));
  console.log(kept(made, 1));
  console.log(countedDown(made));
  console.log(whileLonger(made));
  console.log(sometimes(made));
}
