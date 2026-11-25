// @ts-nocheck
// Enums, namespaces and classes that merge have one object, whatever type of their name stands in front of them, exported or not.
import * as library from "./library";

namespace W {
  type A = string;
  export enum A {
    P = 1,
  }
  enum A {
    Q = 2,
  }
  type B = string;
  enum B {
    P = 1,
  }
  enum B {
    Q = 2,
  }
  type C = string;
  export class C {
    static s = 1;
  }
  namespace C {
    export const n = 2;
  }
  type D = string;
  enum D {
    P = 1,
  }
  export enum D {
    Q = 2,
  }
  export const keys = () => [A, B, C, D].map(it => Object.keys(it).join()).join(" ");
}
console.log(W.keys());
console.log(W.A.P, W.A.Q, W.B, W.C.s, W.C.n, W.D);
console.log(Object.keys(W).join());
console.log(Object.keys(library).join(), library.keys());
console.log(library.E, library.G, library.H, library.I);
