export const plain = [{ message: "a" }, { message: "b" }, { message: "c" }, { message: "d" }];
export const errors = [new Error("a"), new Error("b"), new Error("c"), new Error("d")];
export function theLoopAlone(list, n) {
  let s = 0;
  for (let i = 0; i < n; i++) if (list[i & 3] !== undefined) s++;
  return s;
}
export function readsWhatItLacks(list, n) {
  let s = 0;
  for (let i = 0; i < n; i++) if (list[i & 3].code === undefined) s++;
  return s;
}
export function asksWhetherItHas(list, n) {
  let s = 0;
  for (let i = 0; i < n; i++) if (!("code" in list[i & 3])) s++;
  return s;
}
export function readsWhatItHas(list, n) {
  let s = 0;
  for (let i = 0; i < n; i++) if (list[i & 3].message !== undefined) s++;
  return s;
}
