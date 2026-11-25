// The text of few strings is kept: lists that share their first and last string differ in the middle.
const firsts = ["a", "bb", "", "c"], middles = ["x", "yy", "", "z", "x"], lasts = ["e", "a", "", "long end"];
const out = [];
for (let k = 0; k < 400; k++) {
  const list = [firsts[k & 3], middles[k % 5], k % 7, lasts[(k >> 2) & 3]];
  out.push("" + list, list.join("-"), String(list), [list[0], list[3]].join(), " " + [list[0], middles[(k + 1) % 5], list[3]]);
}
console.log(out.length, out.join("|").length);
console.log(out.slice(0, 60).join(" "));
console.log(out.slice(-40).join(" "));
