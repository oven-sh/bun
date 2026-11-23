// Under: --aot-testing=CheckEffectsAtRunTime: a step over a string that is a rope makes it flat
// Under: --aot-harden=proof-checks: what is kept of the string across a step is asked again
function part(text, count) {
  let s = "";
  for (let i = 0; i < count; i++) s += text + i;
  return s;
}
function keysOf(t) {
  let s = "";
  for (const k in t) {
    s += k;
    if (s.length > 40) break;
  }
  return s;
}
function keysOfSum(t, u) {
  let n = 0;
  for (const k in t + u) n += k.length;
  return n;
}
function readBesideSteps(t, u) {
  const joined = t + u;
  let h = 0;
  for (const k in joined) {
    h += joined.charCodeAt(h % joined.length);
    if (joined === t) h++;
    if (h > 5000) break;
  }
  return h;
}
function readBeforeAndAfter(t, u) {
  const joined = t + u;
  let h = joined === u ? 1 : 2;
  for (const k in joined) h += +k;
  return h + joined.charCodeAt(2) + (joined === u ? 1 : 0);
}
function nested(t, u) {
  let n = 0;
  for (let i = 0; i < 3; i++) for (const k in t + u + i) if (k === "3") n += i;
  return n;
}
function cut(t) {
  const piece = t.slice(3, 30);
  let n = 0;
  for (const k in piece) n += piece.charCodeAt(+k);
  return n;
}
function changed(t, u) {
  let s = t + u,
    n = 0;
  for (const k in s) {
    if (n++ < 3) s = s + k;
    if (s.charCodeAt(1) === 98) n += 2;
  }
  return n + s;
}
function sparse(t, u) {
  const o = Object.assign([1, , 3], { [t + u]: 4 });
  let s = "";
  for (const k in o) s += k + ",";
  return s;
}
const more = process.argv.length > 99 ? 1 : 0;
for (let i = 0; i < 3; i++) {
  const t = part("abcd", 4 + i + more),
    u = part("efgh", 5 + more),
    w = part("中文xyz", 4 + more);
  console.log(keysOf(t + u), keysOf(u + w), keysOfSum(t, u), keysOfSum(w, t));
  console.log(readBesideSteps(t, u), readBesideSteps(u, w), readBeforeAndAfter(t, u), readBeforeAndAfter(w, u));
  console.log(nested(t, u), nested(t, w), cut(t + u), cut(u + w), changed(t, u), changed("ab" + w, t), sparse(t, u));
}
