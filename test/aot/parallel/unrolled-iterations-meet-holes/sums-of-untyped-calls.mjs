// STATISTIC: UnrolledLoopsEmitted >= 60
// A sum that is cut to an int32 takes what an untyped function makes of each element: what is no int32, a text and a hole stand at each place of the list in turn.
function plus(v) { return v + 1; }
function same(v) { return v; }
function worded(v) { return v > 7 ? "" + v : v + 1; }
function cut(list) { let s = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; s = (s + plus(x)) | 0; } return s; }
function cutSame(list) { let s = 0; for (let i = 0; i < list.length; i++) s = (s + same(list[i])) | 0; return s; }
function cutWorded(list) { let s = 0; for (let i = 0; i < list.length; i++) s = (s + worded(list[i])) | 0; return s; }
function mixed(list) { let s = 0; for (let i = 0; i < list.length; i++) s = ((s + plus(list[i])) ^ i) >>> 1; return s; }
function scaled(list) { let s = 0; for (let i = 0; i < list.length; i++) s = (s + plus(list[i])) * 3 % 1000003; return s; }
function less(list) { let s = 0; for (let i = 0; i < list.length; i++) s = (plus(list[i]) + s) - 1; return s; }
function text(list) { let s = ""; for (let i = 0; i < list.length; i++) s = s + plus(list[i]); return s; }
function both(list) { let s = "", n = 0; for (let i = 0; i < list.length; i++) { const x = plus(list[i]); s += x; n = (n + x) | 0; } return s + n; }
const odd = [["a hole", 0], ["undefined", undefined], ["NaN", NaN], ["a fraction", 2.5], ["minus zero", -0], ["past an int32", 2 ** 40], ["past 2^53", 2 ** 60], ["the least int32", -2147483648], ["endless", Infinity], ["null", null], ["a text", "12"], ["a word", "x"], ["true", true], ["an object", { valueOf() { return 12; } }], ["a list", [4]]];
const shown = x => Object.is(x, -0) ? "-0" : String(x);
for (const use of [cut, cutSame, cutWorded, mixed, scaled, less, text, both]) {
  const plain = [];
  for (const length of [0, 1, 7, 8, 9, 24, 33]) plain.push(shown(use(Array.from({ length }, (_, i) => (i * 37) % 11 - 2))), shown(use(Array.from({ length }, (_, i) => i * 1.5 + 0.25))), shown(use(Array.from({ length }, (_, i) => "t" + i))));
  console.log(use.name, plain.join(" "));
  for (const [name, value] of odd) {
    const said = [];
    for (let at = 0; at < 18; at++) {
      const list = []; for (let i = 0; i < 18; i++) list.push((i * 37) % 11 - 2);
      if (name === "a hole") delete list[at]; else list[at] = value;
      said.push(shown(use(list)));
    }
    console.log(use.name, name, said.join(" "));
  }
  try { use([1, 2, 3n, 4]); console.log(use.name, "a BigInt is taken"); } catch (error) { console.log(use.name, error.name); }
  try { use([1, Symbol("s"), 4]); console.log(use.name, "a symbol is taken"); } catch (error) { console.log(use.name, error.name); }
}
