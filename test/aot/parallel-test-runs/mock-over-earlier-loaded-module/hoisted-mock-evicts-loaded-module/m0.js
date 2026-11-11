(globalThis.ran ??= []).push("m0");
export const value = "r0";
export let count = 0;
export function bump() {
  return ++count;
}
export const deep = () => "0";
export default "x0";
