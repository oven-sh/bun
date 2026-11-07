// Flags: --aot-check=verify-each-stage
// A list of constants is read under a test of its storage while a loop appends to another list.
function scene(turn: number): string {
  const list: any = turn >= 2 ? ["a", 1, { k: 1 }] : [1.5, 2.5, -0];
  const [first, ...rest] = list;
  return String(first) + String(rest);
}
for (let turn = 0; turn < 40; turn++) console.log(scene(turn));
