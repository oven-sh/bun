// Made by test/aot/tools/generate-pushes-that-run-code.py.
function make(): number[] {
  const list: number[] = [];
  for (let i = 0; i < 4; i++) list.push(i + 1);
  const above = Object.create(Array.prototype);
  for (let at = 4; at < 24; at++) Object.defineProperty(above, at, { set(x) { list[0]++; } });
  Object.setPrototypeOf(list, above);
  return list;
}
function put(list: number[], seen: number): string {
  const before = list[0];
  list.push(7);
  return before + ":" + list[0];
}
const list = make();
for (let turn = 0; turn < 3; turn++) console.log(put(list, 0), list.length);
