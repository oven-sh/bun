import { A } from "./m1";
declare module "./m1" {
  interface A { y: number; }
  interface B {}
}
declare global {
  interface Foo { c: boolean; }
  var globalFromModule: number;
}
export {};
