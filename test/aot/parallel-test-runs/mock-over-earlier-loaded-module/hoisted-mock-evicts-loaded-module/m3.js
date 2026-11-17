(globalThis.ran ??= []).push("m3");
export const value = "r3";
export let count = 0;
export function bump() {
  return ++count;
}
export const deep = () => "3";
export default "x3";
