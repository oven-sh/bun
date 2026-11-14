function make() { return 1; }
// @ts-ignore
namespace make.bind {
  export const mark = "set";
}
console.log(typeof make.bind, Object.hasOwn(make, "bind"), (Function.prototype.bind as any).mark);
export {};
