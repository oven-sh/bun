function both(a, b) {
  let count = 0;
  while (a.length && b.length) {
    if (/^[a-z]/.test(a)) count++;
    if (/^[0-9]/.test(b)) count += 100;
    a = a.slice(1);
    b = b.slice(2);
  }
  return count + "/" + a.length + "/" + b.length;
}
function met(a, b, c) {
  let count = 0;
  while (a.length || b.length || c.length) {
    const m = a.match(/^[a-z]+/);
    if (m) {
      a = a.slice(m[0].length);
      count += m[0].length;
    } else {
      a = a.slice(1);
      if (/^x/.test(b)) b = b.slice(3);
    }
    if (/^[^ ]/.test(b)) b = b.slice(1);
    else {
      c = c.slice(1);
      b = b.substring(1);
    }
    if (c.startsWith("z")) c = c.slice(2);
    else if (/^./.test(c)) c = c.slice(1);
    if (++count > 400) return [a, b, c].join("!");
  }
  return count;
}
function kept(s, n) {
  let t = "";
  let out = "";
  for (let i = 9; i >= 0; i--) {
    if (s[i] === "b") out += t[n] ?? "?";
    if (s.length > 12) s = s.slice(-11);
    if (t.length > 6) t = t.slice(-5);
    t += s.charCodeAt(0);
  }
  return out + s + t;
}
const texts = JSON.parse(JSON.stringify(["abc1 de23, f", "", "a", "x1 y,z ab9", "äöü1 a😀b", "12 34 56", "zzzxxx", "日本 1a2b"]));
texts.push(("abc" + "1 d").slice(1), ("x" + "12 ab cd ef gh").substring(3));
for (const a of texts) for (const b of texts) console.log(both(a, b), met(a, b, a + b), kept(a + b, 1));
