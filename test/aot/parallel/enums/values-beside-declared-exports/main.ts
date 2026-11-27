// @ts-nocheck
// A value of a namespace that has the name of an export that is only declared: the export has no value, and the namespace has its own.
namespace W {
  export declare enum N {
    D,
  }
  const N = { c: 1 };
  export declare class C {
    d: number;
  }
  let C = 2;
  export declare function f(): void;
  var f = 3;
  export const seen = [typeof N, N.c, C, f].join();
  export function add() {
    C += 1;
    f = C + N.c;
    return [C, f].join();
  }
}
console.log(W.seen, W.add(), W.N, W.C, W.f, Object.keys(W).join());
