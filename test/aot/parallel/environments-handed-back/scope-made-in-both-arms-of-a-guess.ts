// Flags: --aot-check=Validate
// The arms of a guess walk a stretch of the body once each: the allocation of the scope is built twice, and behind the join the scope is dead.
type Box = { value: number } | { value: string; extra: boolean };
function measure(box: Box, more: number) {
  const first = box.value;
  let sum = more;
  function add(n: number) {
    sum += n;
  }
  add(typeof first === "number" ? first : first.length);
  add(more);
  const result = sum;
  if (more > 2) return result * 2;
  return result;
}
const boxes: Box[] = [{ value: 3 }, { value: "four", extra: true }, { value: 5 }, { value: "", extra: false }];
let line = "";
for (let turn = 0; turn < 4; turn++) for (const box of boxes) line += measure(box, turn) + " ";
console.log(line);
