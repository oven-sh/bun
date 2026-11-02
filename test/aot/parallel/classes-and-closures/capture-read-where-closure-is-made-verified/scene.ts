export type Seen = (number | string | undefined)[];
export function same<T>(it: T): T {
  return it;
}
export function called<T>(read: () => T, depth: number): T {
  return depth > 0 ? called(read, depth - 1) : read();
}
export const scene = (given: number[], depth: number): Seen => {
  const seen: Seen = [];
  for (const name in { a: 1, bc: 2, def: 3 }) {
    const at = name.length;
    const it: () => { n: number } = same(() => ({ n: given[at % given.length] }));
    seen.push(called(() => called(it, 1).n, 2));
    seen.push(it() === it() ? "one" : "two");
  }
  return seen;
};
console.log(JSON.stringify(scene([5, 6, 7], 2)));
