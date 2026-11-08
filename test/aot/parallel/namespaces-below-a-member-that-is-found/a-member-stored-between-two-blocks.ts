namespace Outer {
  export const first = 1;
}
(Outer as any).Inner = { stored: true };
namespace Outer.Inner {
  export const mark = "set";
}
console.log(JSON.stringify(Outer));
export {};
