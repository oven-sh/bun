import { current, shared } from "./shared.js";

export async function sizeAroundAnAwait(gate) {
  const before = shared.list.length;
  await gate;
  return [before, shared.list.length];
}
export async function countAroundAnAwait(gate) {
  const before = shared.count + 1;
  await gate;
  return [before, shared.count + 1];
}
export async function parameterAroundAnAwait(box, gate) {
  const before = box.value * 2;
  await gate;
  return [before, box.value * 2];
}
export async function bindingAroundAnAwait(gate) {
  const before = current.length;
  await gate;
  return [before, current.length];
}
export async function loopWithAwaits(box, gates) {
  let sum = 0;
  for (const gate of gates) {
    sum += box.value;
    await gate;
  }
  return sum;
}
export function* sizeAroundAYield() {
  const before = shared.list.length;
  const sent = yield before;
  return [before, shared.list.length, sent.length];
}
export async function* streamed(box) {
  for (let i = 0; i < 3; i++) yield box.value + 1;
}
export async function heldInALocal(gate) {
  const list = shared.list;
  await gate;
  return [list.length, list === shared.list];
}
