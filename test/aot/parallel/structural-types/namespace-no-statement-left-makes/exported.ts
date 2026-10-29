export namespace Declarations {
  declare const a: number;
}
export namespace Members {
  export declare const a: number;
}
export namespace Outer {
  export namespace Inner {
    declare function f(): void;
  }
}
namespace Listed {
  declare const a: number;
}
export { Listed };
export const beside = 1;
