// Made by test/aot/tools/generate-pushes-that-run-code.py.
const others: number[] = [0, 0];
function make(): number[] {
  const list: number[] = [];
  for (let i = 0; i < 4; i++) list.push(i + 1);
  return list;
}
function put(list: number[], seen: number[]): string {
  const before = seen[1];
  list.push(7);
  return before + ":" + seen[1];
}
const list = make();
for (let turn = 0; turn < 3; turn++) console.log(put(list, others), list.length);
