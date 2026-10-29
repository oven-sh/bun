// Flags: --splitting
// A closure three functions deep reads an import in a loop, and a module that is loaded later imports the same name.
import { table } from "./shared";
function first(a: number) {
  const x = a + 1;
  return function second(b: number) {
    const y = b + x;
    return function third(c: number) {
      const z = c + y;
      return function sum(list: number[]) {
        let s = 0;
        for (let i = 0; i < list.length; i++) s += table[i] + list[i] + z;
        return s;
      };
    };
  };
}
console.log(first(1)(2)(3)([1, 2, 3, 4]));
const lazy = await import("./lazy");
console.log(lazy.size());
