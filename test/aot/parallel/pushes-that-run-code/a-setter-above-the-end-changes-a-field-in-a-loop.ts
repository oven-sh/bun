// Made by test/aot/tools/generate-pushes-that-run-code.py.
const holder = { count: 0 };
function make(): number[] {
  const list: number[] = [];
  for (let i = 0; i < 4; i++) list.push(i + 1);
  const above = Object.create(Array.prototype);
  for (let at = 4; at < 24; at++) Object.defineProperty(above, at, { set(x) { holder.count++; } });
  Object.setPrototypeOf(list, above);
  return list;
}
function put(list: number[], seen: { count: number }): string {
  let text = "";
  for (let i = 0; i < 3; i++) {
    const before = seen.count;
    list.push(i);
    text += before + ":" + seen.count + " ";
  }
  return text;
}
const list = make();
for (let turn = 0; turn < 3; turn++) console.log(put(list, holder), list.length);
