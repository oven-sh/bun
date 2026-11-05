// A variable named like a namespace hides the enums of the namespace.
namespace Outer {
  export enum Inner {
    A = 1,
  }
  export namespace Middle {
    export enum Deep {
      A = 100,
    }
  }
}
const other = { Inner: { A: "other" }, Middle: { Deep: { A: "other deep" } } };

function readParameter(Outer: typeof other) {
  return [Outer.Inner.A, Outer["Inner"].A, Outer.Inner["A"], Outer.Middle.Deep.A, Outer["Middle"].Deep.A];
}
console.log("parameter", ...readParameter(other));

function readConstant() {
  const Outer = other;
  return [Outer.Inner.A, Outer["Inner"].A, Outer.Inner["A"], Outer.Middle.Deep.A];
}
console.log("constant", ...readConstant());

function readCaught() {
  try {
    throw other;
  } catch (Outer) {
    return [(Outer as typeof other).Inner.A, (Outer as typeof other)["Inner"].A];
  }
}
console.log("catch", ...readCaught());

class Holder {
  Outer = other;
  read() {
    const { Outer } = this;
    return [Outer.Inner.A, Outer["Inner"].A];
  }
}
console.log("pattern", ...new Holder().read());

namespace Around {
  export const Outer = other;
  export function read() {
    return [Outer.Inner.A, Outer["Inner"].A];
  }
}
console.log("export of a namespace", ...Around.read(), Around.Outer.Inner.A);

namespace Nearer {
  export namespace Outer {
    export enum Inner {
      A = 7,
    }
  }
  export function read() {
    return [Outer.Inner.A, Outer["Inner"].A];
  }
}
console.log("nearer namespace", ...Nearer.read(), Nearer.Outer.Inner.A, Nearer["Outer"]["Inner"].A);

function readBlock(flag: boolean) {
  if (flag) {
    let Outer = other;
    return Outer.Inner.A;
  }
  return Outer.Inner.A;
}
console.log("block", readBlock(true), readBlock(false));

function declareEnum(Outer: { Inner: { A: number } }) {
  enum Local {
    FromParameter = Outer.Inner.A + 1,
  }
  return [Local.FromParameter, Local[41]];
}
console.log("initializer", ...declareEnum({ Inner: { A: 40 } }));
