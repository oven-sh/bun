// sort() with a comparator puts what is undefined behind the values and the holes behind that, and never hands either to the comparator.
const lines = [];
function show(list) {
  const parts = [];
  for (let index = 0; index < list.length; index++) parts.push(index in list ? String(list[index]) : "hole");
  return `${list.length}: ${parts.join(" ")}`;
}
let calls = 0;
const byValue = (a, b) => { calls++; if (a === undefined || b === undefined) lines.push("the comparator was handed undefined"); return a < b ? -1 : a > b ? 1 : 0; };
const lists = {
  "objects and holes": () => [{ toString() { return "c"; } }, , { toString() { return "a"; } }, undefined, , { toString() { return "b"; } }],
  "whole numbers": () => [5, , 3, undefined, 1, , undefined, 4],
  "texts": () => ["pear", undefined, "apple", , "fig"],
  "only holes": () => [, , ,],
  "only undefined": () => [undefined, undefined, undefined],
  "a hole at each end": () => [, 2, 1, ,],
  "null and false": () => [null, , false, undefined, 0, ""],
  "twenty with every third left out": () => Array.from({ length: 20 }, (_, k) => (k * 7) % 20).map((v, k, all) => (k % 3 === 0 ? (delete all[k], v) : v)).filter((_, k) => true),
  "made with a length": () => { const list = new Array(6); list[4] = "y"; list[1] = "z"; list[5] = undefined; return list; },
};
for (const name in lists) {
  for (let again = 0; again < 2; again++) {
    calls = 0;
    const list = lists[name]();
    const result = list.sort(byValue);
    lines.push(`${name}: ${show(list)} | ${result === list} | ${calls} calls`);
    const copy = lists[name]().toSorted(byValue);
    lines.push(`${name}, toSorted: ${show(copy)}`);
  }
}
console.log(lines.join("\n"));
