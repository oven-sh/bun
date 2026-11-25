// The buffer that the memory has handed out is detached: the view holds nothing from then on. No code but the engine's own runs between the two reads.
const show = (value: any): string =>
  Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value === "string" ? JSON.stringify(value) : String(value);
function sum(view: Int32Array, memory: WebAssembly.Memory, turns: number, when: number): number {
  let total = 0;
  for (let at = 0; at < turns; at++) {
    total = (Math.imul(total, 31) + view[at]!) | 0;
    if (at === when) memory.grow(1);
    total = (Math.imul(total, 31) + view[at + 1]! + view.length) | 0;
  }
  return total;
}
function fill(view: Int32Array, memory: WebAssembly.Memory, turns: number, when: number): number {
  for (let at = 0; at < turns; at++) {
    view[at] = at + 1;
    if (at === when) memory.grow(1);
    view[at + 1] = -at;
  }
  return view.length;
}
for (const when of [9, 0, 2]) {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 4 });
  const view = new Int32Array(memory.buffer);
  for (let at = 0; at < 8; at++) view[at] = 3 * at + 1;
  console.log(sum(view, memory, 5, when), view.length, new Int32Array(memory.buffer).slice(0, 8).join(" "));
}
for (const when of [9, 0, 2]) {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 4 });
  console.log(fill(new Int32Array(memory.buffer), memory, 5, when), new Int32Array(memory.buffer).slice(0, 8).join(" "));
}
const memory = new WebAssembly.Memory({ initial: 1, maximum: 4 });
const view = new Int32Array(memory.buffer);
for (let at = 0; at < 8; at++) view[at] = 3 * at + 1;
let total = 0;
for (let at = 0; at < 5; at++) {
  total = (Math.imul(total, 31) + view[at]!) | 0;
  if (at === 2) memory.grow(1);
  total = (Math.imul(total, 31) + view[at + 1]! + view.length) | 0;
}
console.log(total);
