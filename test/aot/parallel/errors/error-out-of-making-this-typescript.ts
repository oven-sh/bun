// Making `this` has no position of its own: an error out of reading the prototype of new.target is reported at the first position that the constructor records.
// Here: what TypeScript adds: parameter properties, casts, enums, declared fields.
function f<T = any>(..._: any[]): any {
  return 0;
}
const g: any = { x: 1, l: [] };
class C2 {}
var p: any = 1;
enum En {
  X = 1,
  Y = "y",
}
const enum Ce {
  X = 1,
}
function column(A: any) {
  const given = { __proto__: A.prototype };
  const B: any = new Proxy(A, { get: (t: any, k: any) => (k === "prototype" ? given : t[k]) });
  try {
    new B();
  } catch (error: any) {
    console.log(error.stack.split("\n").find((line: string) => line.includes("new A")).replace(/.*[\\/]/, ""));
  }
}
column(class A { constructor(private x: number) { f(); } });
column(class A { constructor(private x: number) { } });
column(class A { constructor(private x: number, public y: number) { } });
column(class A { constructor(x: number, public y: number) { f(); } });
column(class A { constructor(public x: number, y: number) { f(y); } });
column(class A { constructor(readonly x = p) { f(); } });
column(class A { constructor(readonly x = 1) { f(); } });
column(class A { constructor(private x: number, ...r: any[]) { f(); } });
column(class A { constructor(private x: number) { this.h = () => x; } h: any; });
column(class A { declare z: number; constructor(a: number) { this.z = a; } });
column(class A { z: number; constructor(a: number) { this.z = a; } });
column(class A { z?: number; constructor(a: number) { this.z = a; } });
column(class A { z!: number; constructor(a: number) { this.z = a; } });
column(class A { private z; constructor(a: any) { this.z = a; } });
column(class A { z: number = 1; constructor() { f(); } });
column(class A { static z: number = 1; constructor() { f(); } });
column(class A { constructor(a?: number) { f(a!); } });
column(class A { constructor(a: any) { (this as any).t = a as number; } });
column(class A { constructor(a: any) { (this as any).t = <number>a; } });
column(class A { constructor(a: any) { (this as any).t = a!; } });
column(class A { constructor(a: any) { (this as any).t = [a as number]; } });
column(class A { constructor(a: any) { (this as any).t = [a!]; } });
column(class A { constructor(a: any) { (this as any).t = { a: a as number }; } });
column(class A { constructor(a: any) { f<number>(a); } });
column(class A { constructor(a: any) { (this as any).t = En.X; f(); } });
column(class A { constructor(a: any) { (this as any).t = En.Y; f(); } });
column(class A { constructor(a: any) { (this as any).t = Ce.X; f(); } });
column(class A { constructor(a: any) { (this as any).t = En[a]; f(); } });
column(class A { constructor(a: any) { const c = a satisfies any; f(); } });
column(class A { constructor(a: any) { const c: number = a; f(); } });
column(class A { constructor(a: any) { let c: number; f(); } });
column(class A { constructor(a: any) { type T = number; f(); } });
column(class A { constructor(a: any) { interface I {} f(); } });
column(class A { constructor(a: any) { enum L { X } f(); } });
column(class A { constructor(a: any) { const enum L { X } (this as any).t = L.X; f(); } });
column(class A { constructor(a: any) { (a as any).b; } });
column(class A { constructor(a: any) { (a as any)(); } });
column(class A { constructor(a: any) { (a as any).b(); } });
column(class A { constructor(a: any) { (<any>this).m(); } });
column(class A { constructor(a: any) { (this as any)[a] = 1; } });
column(class A<T> { constructor(a: T) { (this as any).t = a; } });
column(class A { constructor(); constructor(a?: any) { f(); } });
column(class A { m(): void; m(a?: any) {} constructor(a?: any) { f(); } });
column(class A { constructor(a: any) { if (a as boolean) f(); } });
column(class A { constructor({ a }: any) { f(); } });
column(class A { constructor([a]: any) { f(); } });
column(class A { constructor(a: any = p) { f(); } });
column(class A { constructor(private a: any = p) { f(); } });
column(class A { constructor(private a: any, b = a) { f(); } });
column(class A { [k: string]: any; constructor(a: any) { this.t = a; } });
column(class A { readonly z = 1; constructor() { f(); } });
column(class A { accessor z = 1; constructor() { f(); } });
