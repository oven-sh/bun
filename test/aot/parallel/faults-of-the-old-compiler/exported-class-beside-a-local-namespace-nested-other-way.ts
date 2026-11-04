// @ts-nocheck
namespace Outer {
  class Box { static s = 1; }
  export namespace Box { export const t = Box.s + 1; }
  export const seen = [Box.t, Box.s, typeof Box];
}
console.log(Outer.seen.join(), typeof Outer.Box, Outer.Box?.t, Outer.Box?.s);
export {};
