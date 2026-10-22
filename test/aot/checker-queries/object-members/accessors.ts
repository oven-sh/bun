// Accessors are one member each, by what they declare; a getter and a setter with different types are unwritten.
class A {
  get g(): number { return 1; }
  set s(v: string) {}
  get p(): number { return 1; }
  set p(v: number) {}
  accessor x: boolean = true;
}
let a: A;
class B {
  get d(): string { return ""; }
  set d(v: string | number) {}
}
let b: B;
interface I { get d(): string; set d(v: string | number); }
let i: I;
export {};
