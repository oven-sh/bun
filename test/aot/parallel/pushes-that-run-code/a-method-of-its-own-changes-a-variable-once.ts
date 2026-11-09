// Made by test/aot/tools/generate-pushes-that-run-code.py.
let count = 0;
function make(): number[] {
  const list: number[] = [];
  for (let i = 0; i < 4; i++) list.push(i + 1);
  (list as any).push = function (x: number) { count++; return Array.prototype.push.call(this, x); };
  return list;
}
function put(list: number[], seen: number): string {
  const before = count;
  list.push(7);
  return before + ":" + count;
}
const list = make();
for (let turn = 0; turn < 3; turn++) console.log(put(list, 0), list.length);
