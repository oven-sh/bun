// A diff: the shortest edit by lines, words and letters, unified text written and read, patches applied with moved places, three texts merged, trees of values compared, in two modules
import { Patch, merge, inline, kind, compare, change } from "./lib.mjs";
const A = "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten".split("\n"),
  B = "zero\none\ntwo\n3\nfour\nsix\nseven\neight\nnine and a half\nten\neleven".split("\n");
const patch = Patch.between(A, B);
console.log(String(patch), JSON.stringify(patch.size));
console.log(patch.apply(A).lines.join() === B.join(),
  patch.reverse().apply(B).lines.join() === A.join(),
  String(Patch.parse(String(patch))) === String(patch));
console.log(JSON.stringify(Patch.between(A, B, 0).hunks.map(h => h.header)), Patch.between(A,
  A).hunks.length, Patch.between([], A).size.add, Patch.between(A, []).size.del);
const shifted = ["x", "y", "z", ...A];
const r = patch.apply(shifted);
console.log(r.lines.join(), r.moved.join(), r.rejected.length);
console.log(patch.apply(["nothing", "of", "it"]).rejected.map(h => h.header).join());
console.log(inline("the quick brown fox jumps", "the slow brown dog jumps high"),
  inline("kitten", "sitting", s => [...s]), inline("same", "same"));
const base = "a b c d e f g h i j".split(" ");
for (const [l, rr] of [["a b X d e f g h i j", "a b c d e f g Y i j"], ["a b X d e f g h i j",
  "a b Z d e f g h i j"], ["a b c d e f g h i j k", "0 a b c d e f g h i j"],
  ["a c d e f g h i j", "a b c d g h i j"], ["a b N c d e f g h i j", "a b N c d e f g h i j"],
  ["", "a b c d e f g h i j"], ["a b c e f g h i j", "a b c d D e f g h i j"]]) {
  const m = merge(base, l.split(" ").filter(Boolean), rr.split(" "));
  console.log(m.conflicts, m.lines.join(" "));
}
let seed = 9;
const random = n => (seed = (seed * 48271) % 2147483647) % n;
let hash = 0, wrong = 0, back2 = 0, conflicts = 0;
for (let i = 0; i < 260; i++) {
  const n = 5 + random(50);
  const text = Array.from({ length: n }, () => "line " + random(12));
  const mutate = t => {
    const out = t.slice();
    for (let k = 0; k < 1 + random(6); k++) {
      const at = random(out.length + 1);
      switch (random(3)) {
        case 0: out.splice(at, 0, "new " + random(20));
        break;
        case 1: out.splice(at, 1);
        break;
        default: if (at < out.length) out[at] = out[at] + "!";
      }
    }
    return out;
};
  const one = mutate(text), two = mutate(text);
  const p = Patch.between(text, one, random(4));
  if (p.apply(text, { fuzz: 0 }).lines.join("\n") !== one.join("\n")) wrong++;
  if (p.reverse().apply(one, { fuzz: 0 }).lines.join("\n") !== text.join("\n")) back2++;
  const m = merge(text, one, two);
  conflicts += m.conflicts;
  for (const l of m.lines) for (let k = 0; k < l.length; k += 2) hash = (hash * 31 + l.charCodeAt(k)) >>> 0;
  hash = (hash + p.size.add * 7 + p.size.del) >>> 0;
}
console.log(hash, wrong, back2, conflicts);
const before = {
  name: "x", tags: ["a", "b", "c"], size: {
    w: 1, h: -0
}, when: new Date(5), list: [{ id: 1 }, { id: 2 }], gone: true, n: NaN
}, after = {
  name: "y", tags: ["b", "c", "d", "e"], size: {
    w: 1, h: 0, d: [1]
}, when: new Date(6), list: [{ id: 2 }, { id: 3, more: null }], n: NaN, kind: undefined
};
const ops = [...compare(before, after)];
for (const o of ops) console.log(o.op, "/" + o.path.join("/"), JSON.stringify(o.value),
  JSON.stringify(o.old));
console.log(JSON.stringify(change(before, ops)) === JSON.stringify({ ...after }),
  [...compare(change(before, ops), after)].length, [...compare([1, [2, 3]], [1, [2, 4],
  5])].map(o => o.op + o.path).join(" "), [...compare(null, {})].length);
for (const bad of [() => Patch.parse("@@ -1,2 +1,1 @@\n-a"), () => Patch.parse("rubbish"),
  () => change({}, [{ op: "add", path: ["a", "b"], value: 1 }])]) try {
  bad();
  console.log("fine");
} catch (e) {
  console.log(e.name, e.message);
}
