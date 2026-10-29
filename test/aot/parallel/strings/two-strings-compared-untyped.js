// `a === b` on two strings inside and outside loops, for every pair of internal representations, every length, and null or undefined on either side (the same program without type annotations).
const print = (s) => console.log(s);
function show(x) {
  if (typeof x !== "string")
    return Object.is(x, -0) ? "-0" : String(x);
  let out = '"';
  for (let i = 0;i < x.length; i++) {
    const c = x.charCodeAt(i);
    out += c >= 32 && c < 127 ? x[i] : "\\u" + (c + 65536).toString(16).slice(1);
  }
  return out + '"';
}
function attempt(f) {
  try {
    return show(f());
  } catch (e) {
    return "throws " + e.name;
  }
}
function cat(a, b) {
  return a + b;
}
function cat3(a, b, c) {
  return `${a}${b}${c}`;
}
function part(s, from, to) {
  return s.slice(from, to);
}
function flattened(s) {
  s.charCodeAt(0);
  return s;
}
export function same(a, b) {
  return a === b;
}
export function sameOrNil(a, b) {
  return a === b;
}
export function different(a, b) {
  return a !== b;
}
export function branched(a, b) {
  if (a === b)
    return "=";
  return "#";
}
export function counted(list, wanted) {
  let n = 0;
  for (const s of list)
    if (s === wanted)
      n++;
  return n;
}
export function sameCharacters(a, b, i) {
  return a[i] === b[i];
}
export function ofAny(a, b) {
  return a === b;
}
export function ofFields(p, q) {
  return p.name === q.name;
}
export function recorded(s, t) {
  return { a: 1, b: s === t, c: 2 };
}
export function sameL(a, b, n) {
  let r = false;
  for (let k = 0;k < n; k++)
    r = a === b;
  return r;
}
export function sameOrNilL(a, b, n) {
  let r = false;
  for (let k = 0;k < n; k++)
    r = a === b;
  return r;
}
const f = { recorded, same, sameOrNil, different, branched, counted, sameCharacters, ofAny, ofFields };
const unseen = new Function("f", "return (...args) => f(...args)");
for (const name of Object.keys(f))
  f[name] = unseen(f[name]);
const g = { sameL, sameOrNilL };
const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-_.";
const wide = (s) => ("\u65E5" + s).slice(1);
const rope = (s) => s.length < 2 ? s : s.slice(0, s.length >> 1) + s.slice(s.length >> 1);
const deepRope = (s) => {
  let out = "";
  for (const c of s)
    out = out + c;
  return out;
};
const wideRope = (s) => s.length < 2 ? wide(s) : wide(s.slice(0, 1)) + s.slice(1);
const cutOut = (s) => ("<<" + s + ">>").substring(2, 2 + s.length);
const cutOutOfWide = (s) => wide("<<" + s + ">>").substring(2, 2 + s.length);
const cutOutTwice = (s) => ("<<<<" + s + ">>>>").substring(2, 6 + s.length).substring(2, 2 + s.length);
const fresh = (s) => String.fromCharCode(...[...s].map((c) => c.charCodeAt(0)));
const key = (s) => Object.keys({ [s]: 1 })[0] ?? "";
const kinds = [["same", (s) => s], ["wide", wide], ["rope", rope], ["deepRope", deepRope], ["wideRope", wideRope], ["part", cutOut], ["partOfWide", cutOutOfWide], ["partOfPart", cutOutTwice], ["fresh", fresh], ["key", key]];
for (const [first, make] of kinds) {
  let out = first + ":";
  for (const [second, other] of kinds) {
    let bits = "";
    for (const n of [0, 1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17, 31, 32, 33, 64, 65]) {
      const text = alphabet.slice(0, n);
      const changed = (at) => n ? text.slice(0, at) + "#" + text.slice(at + 1) : "#";
      const answers = [f.same(make(text), other(text)), f.same(make(text), other(changed(0))), f.same(make(changed(n - 1)), other(text)), f.same(make(text), other(changed(n >> 1))), f.same(make(text), other(text + "x")), f.different(make(text), other(text)), f.branched(make(text), other(text)) === "=", f.sameOrNil(make(text), other(text)), f.ofAny(make(text), other(text)), f.ofFields({ name: make(text) }, { name: other(text) })];
      bits += answers.map(Number).join("") === "1000001111" ? "." : "[" + n + ":" + answers.map(Number).join("") + "]";
    }
    out += " " + second + "=" + bits;
  }
  print(out);
}
print([[undefined, undefined], [null, null], [undefined, null], [null, undefined], ["", undefined], [undefined, ""], ["a", null], [null, "a"], ["", ""], ["", rope("")], [wide(""), ""], ["undefined", undefined], ["null", null]].map(([a, b]) => Number(f.sameOrNil(a, b))).join(""));
print(["caf\xE9", "\u65E5\u672C", "a\x00b", "\uD83D\uDE00", "\uD83D", "e\u0301"].map((t) => kinds.map(([, make]) => kinds.map(([, other]) => Number(f.same(make(t), other(t))) + "" + Number(f.same(make(t), other(t + "x"))) + Number(f.same(make(t), other(t.slice(0, -1) + "z")))).join("")).join(" ")).join(" | "));
print([f.counted(["a", "b", rope("ab"), "ab", wide("ab")], "ab"), f.counted([], "x"), f.sameCharacters("abc", "xbz", 1), f.sameCharacters("abc", "xbz", 0), f.sameCharacters("abc", "ab", 2), f.same("x".repeat(5000), "x".repeat(5000)), f.same("x".repeat(5000), "x".repeat(4999) + "y"), f.same(rope("x".repeat(5000)), deepRope("x".repeat(500)).repeat(10))].join());
{
  let n = 0;
  const names = ["alpha", "beta", "gamma", "delta"];
  for (let i = 0;i < 40000; i++) {
    if (f.same(names[i & 3], i % 5 ? names[i >> 2 & 3] : fresh(names[i & 3])))
      n++;
    if (f.sameOrNil(i % 7 ? names[i & 3] : undefined, i % 11 ? names[i & 3] : null))
      n += 2;
  }
  print(String(n));
}
print([["x", "x"], ["x", "y"], [rope("abcd"), "abcd"]].map(([s, t]) => JSON.stringify(f.recorded(s, t))).join());
{
  let compared = 0, differ = 0;
  for (const [, make] of kinds)
    for (const [, other] of kinds)
      for (const n of [0, 1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17, 31, 32, 33, 64, 65]) {
        const text = alphabet.slice(0, n);
        for (const t of [text, "#" + text.slice(1), text.slice(0, -1) + "#", text + "x", text.slice(1), text.slice(0, -1) + "\xE9", text.slice(0, -1) + "\u0161"]) {
          compared += 2;
          if (f.same(make(text), other(t)) !== g.sameL(make(text), other(t), 1))
            differ++;
          if (f.sameOrNil(make(t), other(text)) !== g.sameOrNilL(make(t), other(text), 1))
            differ++;
        }
      }
  for (const a of [undefined, null, "", "a", rope("ab")])
    for (const b of [undefined, null, "", "a", "ab"]) {
      compared++;
      if (f.sameOrNil(a, b) !== g.sameOrNilL(a, b, 1))
        differ++;
    }
  print("the stub against the code in place: " + compared + " compared, " + differ + " differ");
}
globalThis.kept = [sameL, sameOrNilL, recorded, same, sameOrNil, different, branched, counted, sameCharacters, ofAny, ofFields];
console.log("number");
