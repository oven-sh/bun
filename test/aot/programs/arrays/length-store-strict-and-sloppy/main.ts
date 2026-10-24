// `list.length = n` where the compiler knows that list is an array and the array cannot change: strict code throws and sloppy code does nothing, also where one calls the other and is inlined.
import { cut, rows } from "./sloppy.cjs";
function frozen(): number[] {
  const list = [1, 2, 3];
  Object.freeze(list);
  return list;
}
function withReadOnlyLength(): number[] {
  const list = [1.5, 2.5, 3.5];
  Object.defineProperty(list, "length", { writable: false });
  return list;
}
function cutTyped(list: number[]): number {
  list.length = 1;
  return list.length;
}
function cutsOwnLiteral(): number {
  const list = [1, 2, 3];
  Object.freeze(list);
  list.length = 1;
  return list.length;
}
function callsSloppy(list: number[]): number {
  return cut(list);
}
const typed: Record<string, () => unknown> = {
  "TypeScript, writable": () => cutTyped([1, 2, 3]),
  "TypeScript, frozen": () => cutTyped(frozen()),
  "TypeScript, read-only length": () => cutTyped(withReadOnlyLength()),
  "TypeScript, its own frozen literal": () => cutsOwnLiteral(),
  "TypeScript calls sloppy, writable": () => callsSloppy([1, 2, 3]),
  "TypeScript calls sloppy, frozen": () => callsSloppy(frozen()),
  "TypeScript calls sloppy, read-only length": () => callsSloppy(withReadOnlyLength()),
};
for (const [name, row] of [...Object.entries(typed), ...Object.entries(rows(cutTyped) as Record<string, () => unknown>)]) {
  try {
    console.log(name + ": " + row());
  } catch (error) {
    console.log(name + ": " + (error as Error).constructor.name);
  }
}
