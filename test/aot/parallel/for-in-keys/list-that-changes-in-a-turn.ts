// A turn of a for-in over a list pops, pushes, sets the length to nothing, stores far behind the end, or lays a getter on an index that is still to come.
function walk(list: number[], change: (list: number[], i: string) => void) {
  let text = "";
  for (const i in list) {
    change(list, i);
    text += i + "=" + list[i as any] + " ";
  }
  return text + "(" + list.length + ")";
}
const nothing = () => {};
function deed() {
  return [
    walk([1, 2, 3, 4], (list, i) => { if (i === "1") list.pop(); }),
    walk([1, 2, 3], (list, i) => { if (i === "0") list.push(9); }),
    walk([1, 2, 3], (list, i) => { if (i === "0") list.length = 0; }),
    walk([1, 2, 3], (list, i) => { if (i === "0") list[100000] = 5; }),
    walk([1, 2, 3], (list, i) => { if (i === "0") Object.defineProperty(list, 2, { get() { return 30; }, enumerable: true, configurable: true }); }),
    walk([1, 2, 3], (list, i) => { if (i === "0") (list as unknown[])[1] = "text"; }),
  ].join(" | ");
}
console.log(deed());
for (let round = 0; round < 3; round++) console.log(walk([round, 2, 3], nothing), "#", deed());
