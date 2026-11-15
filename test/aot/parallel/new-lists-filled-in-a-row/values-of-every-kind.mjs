function text(list) { let all = String(list.length); for (let i = 0; i < list.length; i++) all += "|" + (i in list ? String(list[i]) : "hole"); return all; }
const same = (0, eval)("(x) => x");
const kept = { toString() { return "kept"; } };
const values = [1, -0, 1.5, NaN, Infinity, "t", "", true, null, undefined, kept, 10n, Symbol.iterator.description, () => 1, [1, 2]];
for (const length of [0, 1, 2, 3, 7, 8, 126, 127, 128, 129, 1000]) {
  const said = [];
  for (const value of values) {
    const list = new Array(same(length)).fill(same(value));
    let right = list.length === length && Array.isArray(list);
    for (let i = 0; i < length; i++) right = right && i in list && Object.is(list[i], value);
    list.push("more");
    list[0] = 0.5;
    right = right && list.length === length + 1 && list[length] === (length === 0 ? 0.5 : "more");
    said.push(right ? "y" : "N");
  }
  console.log(length, said.join(""), text(new Array(length).fill(length)).length, text(Array.from({ length })).length);
}
console.log(text(new Array(3).fill(kept)), text(new Array(2).fill()), text(Array.from({ length: 3 })), text(new Array(4).fill(1.5)), text(new Array(4).fill(7).map((x, i) => x + i)));
