// Short ropes that are read, kept, used as keys and read again across collections.
const id = v => JSON.parse("0", () => v);
const text = id(v => "" + v);
const line = id(function (a, b, c) { return "[" + text(a) + "] " + text(b) + ": " + text(c) + "!"; });
const nested = id(function (a, b, c) { let s = "<" + text(a); s += line(a, b, c); s += text(c) + line(c, b, a); return s + ">"; });
const kept = [], keys = new Map(), table = {};
for (let i = 0; i < 4000; i++) {
  const s = line(i & 63, i % 7 ? "b" + (i & 3) : "", i);
  if (s.charCodeAt(0) !== 91 || s.charCodeAt(s.length - 1) !== 33) console.log("wrong", i);
  if (i % 3 === 0) kept.push(s);
  if (i % 5 === 0) keys.set(s, i);
  if (i % 11 === 0) table[s] = i;
  if (i % 13 === 0) {
    const n = nested(i, "x", i & 7);
    if (n.charCodeAt(0) !== 60 || n[n.length - 1] !== ">") console.log("wrong", n);
    kept.push(n);
  }
  if (i % 1000 === 999) Bun.gc(true);
}
const wide = kept.map((s, i) => (i % 9 ? s + i : s + "\u0416" + i)), twice = kept.map(s => s + s.length);
let wrong = 0, place = 0;
for (let i = 0; i < kept.length; i++) if (wide[i].charCodeAt(0) !== kept[i].charCodeAt(0) || twice[i].charCodeAt(1) !== kept[i].charCodeAt(1) || twice[i] !== kept[i] + kept[i].length) wrong++;
for (let i = 0; i < 4000; i++) {
  const s = "[".concat(i & 63, "] ", i % 7 ? "b" + (i & 3) : "", ": ", i, "!");
  if (i % 3 === 0 && kept[place++] !== s) wrong++;
  if (i % 5 === 0 && keys.get(s) !== i) wrong++;
  if (i % 11 === 0 && table[s] !== i) wrong++;
  if (i % 13 === 0) {
    const n = i & 7, long = `<${i}[${i}] x: ${n}!${n}[${n}] x: ${i}!>`;
    if (kept[place++] !== long) wrong++;
  }
}
console.log(wrong, kept.length, keys.size, Object.keys(table).length, kept[kept.length - 1], JSON.stringify(kept.slice(0, 3)), kept[40].slice(2, 9), kept[41].split(":"), /b(\d)/.exec(kept[1])?.[1], kept[3] < kept[4]);
