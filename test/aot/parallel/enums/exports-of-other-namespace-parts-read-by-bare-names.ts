// Parts of a namespace read what another part exports by the bare name: enums, namespaces and what merges with them. The enum objects change afterwards, so a read that has the value in place shows it. A read ahead of the part of its enum has the object.
function change(object: unknown) {
  const held = object as Record<string, unknown>;
  for (const name of Object.keys(held)) {
    if (typeof held[name] !== "object" && typeof held[name] !== "function") held[name] = "changed";
  }
}
function attempt(read: () => unknown) {
  try {
    return read();
  } catch (error) {
    return (error as Error).name;
  }
}

namespace M {
  export enum Z {
    Q = 3,
    W = 4,
    Neg = -3,
    Text = "a",
  }
  export const enum K {
    A = 7,
  }
}
namespace M {
  export enum Y {
    P = Z.Q,
    R,
    S = Z.Q | Z.W,
    T = Z["Q"] + 1,
    U = Z.Text,
  }
  export function reads() {
    return [Z.Q, Z["W"], typeof Z.Q, Z.Neg ** 2, Z.Text, K.A, Z?.Q, (Z as any).Q, Z[3], `${Z.W}`];
  }
  export function shadowed(M: number) {
    return [M, Z.Q];
  }
  export function param(Z: { Q: string }) {
    return Z.Q;
  }
  // A member that is a text at run time gets no key for its value, and a number does.
  export enum AtRunTime {
    P = (Z.Text + String(Date.now() < 0)) as any,
    N = Z.Q + Number(Date.now() < 0),
  }
  export const early = attempt(() => Later.A);
  export function later() {
    return [Later.A, Later["A"]];
  }
  export function countsOnFromLater() {
    enum FromLater {
      P = Later.A,
      R,
    }
    return FromLater;
  }
}
namespace M {
  export enum Later {
    A = 9,
  }
  export enum X {
    A = Y.R,
    B,
  }
}
namespace M {
  export namespace N {
    export enum Deep {
      A = 100,
    }
  }
}
namespace M {
  export function deep() {
    return [N.Deep.A, N["Deep"].A, N.Deep["A"]];
  }
}
namespace A.B {
  export enum Z {
    Q = 5,
  }
}
namespace A.B {
  export enum Y {
    P = Z.Q,
    R,
  }
  export const read = () => Z.Q;
}
namespace AcrossFunction {
  export function F() {}
}
namespace AcrossFunction {
  export namespace F {
    export enum E {
      Q = 3,
    }
  }
}
namespace AcrossFunction {
  export enum Y {
    P = F.E.Q,
    R,
  }
  export const read = () => F.E.Q;
}
namespace AcrossClass {
  export class C {}
}
namespace AcrossClass {
  export namespace C {
    export enum E {
      Q = 3,
    }
  }
}
namespace AcrossClass {
  export enum Y {
    P = C.E.Q,
    R,
  }
  export const read = () => C.E.Q;
}
namespace Same {
  export enum Same {
    Q = 3,
  }
}
namespace Same {
  export enum Y {
    P = Same.Q,
    R,
  }
  export const read = () => Same.Q;
}
namespace Outer {
  export enum Z {
    Q = 11,
  }
}
namespace Outer {
  export namespace Inner {
    export const read = () => Z.Q;
    export enum Y {
      P = Z.Q,
      R,
    }
  }
}

console.log("enums", JSON.stringify([M.Y, M.X, A.B.Y, AcrossFunction.Y, AcrossClass.Y, Same.Y, Outer.Inner.Y]));
console.log("at run time", JSON.stringify(M.AtRunTime));
console.log("ahead of the part", M.early, JSON.stringify(M.later()), JSON.stringify(M.countsOnFromLater()));
console.log(
  "before",
  M.reads(),
  M.shadowed(1),
  M.param({ Q: "q" }),
  M.deep(),
  A.B.read(),
  AcrossFunction.read(),
  AcrossClass.read(),
  Same.read(),
  Outer.Inner.read(),
);
for (const object of [M.Z, M.Later, M.N.Deep, A.B.Z, AcrossFunction.F.E, AcrossClass.C.E, Same.Same, Outer.Z, M.Y, M.X])
  change(object);
console.log(
  "after",
  M.reads(),
  M.shadowed(1),
  M.param({ Q: "q" }),
  JSON.stringify(M.later()),
  M.deep(),
  A.B.read(),
  AcrossFunction.read(),
  AcrossClass.read(),
  Same.read(),
  Outer.Inner.read(),
);
console.log(
  "after",
  attempt(() => M.Y.P),
  attempt(() => M.Y.R),
  attempt(() => M.Y.S),
  attempt(() => M.Y.T),
  attempt(() => M.Y.U),
  attempt(() => M.X.A),
  attempt(() => M.X.B),
);
