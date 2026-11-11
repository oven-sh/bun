(globalThis.ran ??= []).push("m2");
export const value = "r2";
export let count = 0;
export function bump() {
  return ++count;
}
export const deep = () => "2";
export default "x2";
