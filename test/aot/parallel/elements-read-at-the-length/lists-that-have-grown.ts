// list[list.length - 1] behind a write, where the length from before the write says that the list is not empty: the old length is a number there, and no bound.
function add(list: number[], x: number): number | undefined {
  const before = list.length;
  list.push(x);
  if (list.length > before) return list[list.length - 1];
}
function drop(list: number[]): number | undefined {
  const before = list.length;
  list.shift();
  if (before > list.length && list.length > 0) return list[list.length - 1];
}
function pops(list: number[]): number | undefined {
  const old = list.length;
  list.pop();
  const now = list.length;
  if (now > old) return list[now - 1];
  if (old > now) return list[now];
  return -1;
}
function cut(list: number[], k: number): number | undefined {
  const old = list.length;
  list.length = k;
  if (k < old && list.length < old) return list[k];
  if (list.length > old) return list[list.length - 1];
  return list[old - 1];
}
class Stack {
  items: number[] = [];
  push(x: number): number | undefined {
    const before = this.items.length;
    this.items.push(x);
    const now = this.items.length;
    if (now > before) return this.items[now - 1];
  }
}
function drain(queue: number[]): number[] {
  const out: number[] = [];
  let last = queue.length;
  while (queue.length > 0) {
    out.push(queue.pop()!);
    if (queue.length < last) {
      last = queue.length;
      if (last > 0) out.push(queue[last - 1]!);
    }
  }
  return out;
}
function tail(list: number[], more: number[]): number[] {
  const from = list.length;
  for (const x of more) list.push(x);
  const out: number[] = [];
  for (let i = from; i < list.length; i++) out.push(list[i]!);
  return out;
}
const items: string[] = [];
function load(name: string) { if (name !== "") items.push(name); }
for (const name of ["a", "", "b"]) {
  const before = items.length;
  load(name);
  if (items.length > before) console.log("new", items[items.length - 1]);
}
console.log(add([1, 2], 3), add([], 7), add([1.5], 2.5));
console.log(drop([1, 2]), drop([]), drop([1]));
console.log(pops([1, 2]), pops([]), pops([3]));
console.log(cut([1, 2, 3], 1), cut([1, 2, 3], 3), cut([1], 4), cut([], 0));
const s = new Stack();
console.log(s.push(4), s.push(5.5));
console.log(drain([1, 2, 3]).join(), tail([1, 2], [3, 4]).join());
export {};
