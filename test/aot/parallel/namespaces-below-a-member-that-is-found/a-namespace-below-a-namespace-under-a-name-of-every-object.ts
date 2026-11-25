namespace Outer.valueOf {
  export const mark = "set";
}
console.log(typeof Outer.valueOf, Object.hasOwn(Outer, "valueOf"), (Object.prototype.valueOf as any).mark);
export {};
