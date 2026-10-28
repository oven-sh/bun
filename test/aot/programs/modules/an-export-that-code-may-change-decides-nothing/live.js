export let mode = false;
export var early = 1;
export let counter = 0;
export const held = { on: false };
export function enable() {
  mode = true;
  early = 2;
  held.on = true;
}
export function count() {
  counter++;
}
