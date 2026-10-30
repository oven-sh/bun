// The list has storage for any value where it was filled by push(). A validating build keeps both reads of one element in one block.
// Flags: --aot-validate
function lessEach(from: number[], to: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < from.length; i++) {
    if (typeof from[i] === "number") to[i] = from[i] - 97;
    out.push(from[i]);
  }
  return out;
}
const pushed: number[] = (() => {
  const list = [];
  for (const each of [1.5, 100, 3.5]) list.push(each);
  return list;
})();
console.log(JSON.stringify(lessEach(pushed, pushed)), JSON.stringify(pushed));
const written = [1.5, 100, 3.5, 4.5];
console.log(JSON.stringify(lessEach(written, [0])), JSON.stringify(written));
