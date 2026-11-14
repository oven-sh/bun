// What a loop searches for is the very value that it searches in.
function find(l, x) { for (let i = 0; i < l.length; i++) { if (l[i] === x) return i; } return -1; }
function count(l, x) { let n = 0; for (let i = 0; i < l.length; i++) if (x === l[i]) n++; return n + ":" + typeof x + ":" + String(x).length; }
function last(l, x, y) { let at = -1; for (let i = 0; i < l.length; i++) { if (l[i] === x) at = i; if (l[i] !== y) at += 2; } return at + String(x) + String(y); }
const own = ["p", "q"]; own.push(own);
const made = ["a", "", "ab", "٠", "\u{1F600}", "aa", JSON.parse('"z"'), ("x" + process.argv.length).slice(0, 1), [1, 2], own, ["a"], [], { length: 2, 0: "a", 1: "b" }, new String("a"), new Uint8Array([1]), 7];
const said = [];
for (let t = 0; t < 3; t++) for (const l of made) {
  said.push(find(l, l), count(l, l), l === own ? "own" : last(l, l, l), l === own ? "own" : last(l, "a", l), l === own ? "own" : last(l, l, "a"), find(l, l[0]), find(l[0] ?? [], l), count(l, l[0] ?? l));
}
console.log(said.join());
function inModule() { const got = []; for (const l of made) got.push(find(l, l), find(l, 0.5), find(l, "a"), find(l, undefined), find(l, null), find(l, l)); return got.join(); }
console.log(inModule(), inModule());
