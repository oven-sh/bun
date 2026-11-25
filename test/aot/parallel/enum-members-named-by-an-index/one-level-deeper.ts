namespace Outer {
  export namespace Inner {
    export enum Level {
      Low = 1,
      Mid = 2,
      // @ts-ignore
      "2" = 1,
    }
  }
}
const unseen = (0, eval)("(x) => x");
const level = unseen(Outer.Inner.Level);
console.log(String(level[1]), String(level[2]), String(level.Low), String(level.Mid), Object.keys(level).join());
