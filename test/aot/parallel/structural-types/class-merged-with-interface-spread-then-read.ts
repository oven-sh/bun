// A spread of an object whose class is merged with an interface holds what the constructor stored, and a read of it through `any` is a number. The executable ended by a fault here.
interface N {
  kind: 1 | 2;
  pos: number;
}
class N {
  constructor(kind: 1 | 2, pos: number) {
    this.kind = kind;
    this.pos = pos;
  }
}
interface A extends N {
  kind: 1;
  a: number;
}
interface B extends N {
  kind: 2;
  b: number;
}
function mkA(): A {
  const o = new N(1, 7) as A;
  o.a = 5;
  return o;
}
function mkB(): B {
  const o = new N(2, 8) as B;
  o.b = 6;
  return o;
}
const say = (v: unknown) => typeof v + ":";
mkA();
const n = mkB();
const c: any = { ...n };
console.log(Object.keys(c).join(), say(c.pos));
export {};
