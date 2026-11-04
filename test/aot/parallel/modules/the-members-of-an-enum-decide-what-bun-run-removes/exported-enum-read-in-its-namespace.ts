// @ts-nocheck
namespace N {
  export enum E { A = 4 }
  export const c = E.A ? 1 : module;
}
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
