// @ts-nocheck
// An exported enum or class and an exported type of its name, in either order: the type is erased, and the value is exported.
import * as library from "./library";
import { First, Last } from "./library";

namespace W {
  export enum M {
    P = 1,
  }
  export interface M {}
  export class N {
    p = 2;
  }
  export type N = number;
  export interface K {}
  export enum K {
    A = 1,
  }
  export enum K {
    B = 2,
  }
  export type L = string;
  export class L {
    static s = "static";
  }
  export const seen = [typeof M, typeof N, typeof K, typeof L].join();
}
namespace W {
  export enum M {
    Q = 7,
  }
}
export interface Own {}
export enum Own {
  O = 5,
}
console.log(W.M, W.M.P, W.M[1], W.M.Q);
console.log(typeof W.N, new W.N().p);
console.log(W.K, W.K.A + W.K.B);
console.log(W.L.s, W.seen, Object.keys(W).join());
console.log(Own.O, Own[5]);
console.log(library.First.A, library.Last.B, library.Class.name, Object.keys(library).join());
console.log(First, Last.B, library.Both);
