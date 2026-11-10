(globalThis.ran ??= []).push("m1");
export const value = "r1";
export let count = 0;
export function bump() {
  return ++count;
}
export const deep = () => "1";
export default "x1";
