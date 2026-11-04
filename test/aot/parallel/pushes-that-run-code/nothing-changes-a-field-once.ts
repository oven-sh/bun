// Made by test/aot/tools/generate-pushes-that-run-code.py.
const holder = { count: 0 };
function make(): number[] {
  const list: number[] = [];
  for (let i = 0; i < 4; i++) list.push(i + 1);
  return list;
}
function put(list: number[], seen: { count: number }): string {
  const before = seen.count;
  list.push(7);
  return before + ":" + seen.count;
}
const list = make();
for (let turn = 0; turn < 3; turn++) console.log(put(list, holder), list.length);
