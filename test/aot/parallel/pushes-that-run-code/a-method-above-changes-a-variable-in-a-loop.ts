// Made by test/aot/tools/generate-pushes-that-run-code.py.
let count = 0;
function make(): number[] {
  const list: number[] = [];
  for (let i = 0; i < 4; i++) list.push(i + 1);
  Object.setPrototypeOf(list, { __proto__: Array.prototype, push(x: number) { count++; return Array.prototype.push.call(this, x); } });
  return list;
}
function put(list: number[], seen: number): string {
  let text = "";
  for (let i = 0; i < 3; i++) {
    const before = count;
    list.push(i);
    text += before + ":" + count + " ";
  }
  return text;
}
const list = make();
for (let turn = 0; turn < 3; turn++) console.log(put(list, 0), list.length);
