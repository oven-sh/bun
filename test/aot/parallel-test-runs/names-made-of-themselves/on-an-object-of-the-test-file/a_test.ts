// The object is made in the test file.
import { spyOn, test } from "bun:test";
const board: Record<string, () => number> = { tick: () => 1, tickNext: () => 2, tickNextNext: () => 3 };
function watch(name: string, left: number) {
  spyOn(board, name);
  if (left > 0) watch(name + "Next", left - 1);
}
test("chain", () => {
  watch("tick", 2);
  board.tick();
  board.tickNextNext();
  const calls = (f: any) => f.mock.calls.length;
  console.log("calls", calls(board.tick), calls(board.tickNext), calls(board.tickNextNext));
});
