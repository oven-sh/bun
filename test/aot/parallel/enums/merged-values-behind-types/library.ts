// @ts-nocheck
type E = string;
enum E {
  P = 1,
}
enum E {
  Q = 2,
}
interface F {}
class F {
  static s = 1;
}
namespace F {
  export const n = 2;
}
interface G {}
export enum G {
  P = 1,
}
enum G {
  Q = 2,
}
namespace H {
  export const n = 1;
}
export enum H {
  P = 2,
}
export namespace I {
  export const n = 1;
}
enum I {
  P = 2,
}
export const keys = () => [E, F, G, H, I].map(it => Object.keys(it).join()).join(" ");
