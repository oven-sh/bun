// A method is added to the prototype of a subclass that only inherited it: calls through the base type find it, for that subclass and the classes below it and for no other.
class A {
  foo(): number {
    return 1;
  }
  get size(): number {
    return 10;
  }
}
class B extends A {}
class C extends B {}
class D extends B {
  override foo(): number {
    return super.foo() + 100;
  }
}
class Sibling extends A {}
function callFoo(a: A): number {
  return a.foo();
}
function readSize(a: A): number {
  return a.size;
}
function all(label: string): void {
  console.log(label + ": " + callFoo(new A()) + " " + callFoo(new B()) + " " + callFoo(new C()) + " " + callFoo(new D()) + " " + callFoo(new Sibling()) + ", sizes " + readSize(new A()) + " " + readSize(new B()) + " " + readSize(new C()));
}
all("as declared");
Object.defineProperty(B.prototype, "foo", { value(): number { return 2; }, writable: true, configurable: true });
all("defined on B.prototype");
(C.prototype as any).foo = function (): number { return 3; };
all("stored on C.prototype");
Object.defineProperty(B.prototype, "size", { get(): number { return 20; }, configurable: true });
all("a getter defined on B.prototype");
delete (B.prototype as any).foo;
all("deleted from B.prototype");
delete (C.prototype as any).foo;
delete (B.prototype as any).size;
all("as declared again");
const early = new C();
Object.setPrototypeOf(C.prototype, Sibling.prototype);
(Sibling.prototype as any).foo = function (): number { return 5; };
all("C.prototype under Sibling.prototype");
console.log("an instance from before: " + callFoo(early));
const shadowed: any = new B();
shadowed.foo = (): number => 6;
console.log("an own property: " + callFoo(shadowed) + " " + callFoo(new B()));
