// One part of a namespace exports a function, or a class, and a namespace of the same name. Another part reads an enum of that namespace by the bare name and counts on from it.
// Todo: The build puts the value in place of `F.E.A` and `C.E.A`, and plain Bun reads the object: its transpiler does not follow a namespace that shares a block with a function or a class of its name (#47001).
namespace M {
  export function F() {}
  export namespace F {
    export enum E {
      A = 1,
    }
  }
  export class C {}
  export namespace C {
    export enum E {
      A = 5,
    }
  }
}
namespace M {
  export enum FromFunction {
    P = F.E.A,
    R,
  }
  export enum FromClass {
    P = C.E.A,
    R,
  }
  export function read() {
    return [F.E.A, C.E.A];
  }
}
console.log(JSON.stringify(M.FromFunction), JSON.stringify(M.FromClass), JSON.stringify(M.read()));
(M.F.E as Record<string, unknown>).A = "changed";
(M.C.E as Record<string, unknown>).A = "changed";
console.log(JSON.stringify(M.read()));
