function lay(on: any) { on.Inner = { stored: true }; return 1; }
namespace Outer {
  export const first = lay(Outer);
  export namespace Inner {
    export const mark = "set";
  }
}
console.log(JSON.stringify(Outer));
export {};
