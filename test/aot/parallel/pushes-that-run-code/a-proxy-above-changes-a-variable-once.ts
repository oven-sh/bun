// Made by test/aot/tools/generate-pushes-that-run-code.py.
let count = 0;
function make(): number[] {
  const list: number[] = [];
  for (let i = 0; i < 4; i++) list.push(i + 1);
  Object.setPrototypeOf(list, new Proxy(Array.prototype, { set(target, key, x, receiver) { count++; return Reflect.defineProperty(receiver, key, { value: x, writable: true, enumerable: true, configurable: true }); } }));
  return list;
}
function put(list: number[], seen: number): string {
  const before = count;
  list.push(7);
  return before + ":" + count;
}
const list = make();
for (let turn = 0; turn < 3; turn++) console.log(put(list, 0), list.length);
