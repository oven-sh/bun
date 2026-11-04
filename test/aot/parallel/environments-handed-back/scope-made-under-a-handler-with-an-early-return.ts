// Flags: --aot-check=Validate
// The scope of the block is made under the handler, and a throw may leave the block in front of the allocation.
function five() {
  return 5;
}
function bump(n: number) {
  return n + 1;
}
function earlyHandled(flag: boolean) {
  try {
    const read = () => other;
    if (flag) return "got " + read();
    const other = bump(five());
    return "fine " + read();
  } catch (e) {
    return "caught " + (e as Error).name;
  }
}
function countedUnderHandler(limit: number) {
  let seen = 0;
  function step() {
    seen++;
    if (seen > limit) throw new RangeError("over " + limit);
  }
  try {
    step();
    step();
    if (limit > 5) return "early " + seen;
    step();
    return "whole " + seen;
  } catch (e) {
    return (e as Error).message + " at " + seen;
  } finally {
    step;
  }
}
for (let turn = 0; turn < 3; turn++) console.log(earlyHandled(false), earlyHandled(true), countedUnderHandler(1), countedUnderHandler(2), countedUnderHandler(3), countedUnderHandler(9));
