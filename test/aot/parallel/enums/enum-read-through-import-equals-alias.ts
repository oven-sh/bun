// `import X = A.B` names an enum or a namespace of the file. Plain Bun puts the value in place of a member that is read through the alias, so the next member of an enum counts on and a later store to the enum object is not seen. It reads the object where a namespace exports the alias, where another binding has its name, behind `?.`, and in a top-level enum that reads into a namespace.
function change(object: unknown) {
  const held = object as Record<string, unknown>;
  for (const name of Object.keys(held)) {
    if (typeof held[name] !== "object" && typeof held[name] !== "function") held[name] = "changed";
  }
}

enum Z {
  Q = 3,
  Text = "a",
}
import X = Z;
enum FromAlias {
  P = X.Q,
  R,
}
namespace A {
  export enum Z {
    Q = 5,
  }
}
import AZ = A.Z;
import N = A;
import W = AZ;
namespace B {
  export enum FromNamespace {
    P = AZ.Q,
    R,
  }
  export enum FromNamespaceAlias {
    P = N.Z.Q,
    R,
  }
  export enum FromAliasOfAlias {
    P = W.Q,
    R,
  }
}
enum TopLevel {
  P = AZ.Q,
  R = 1,
}
namespace M {
  export enum Z {
    Q = 9,
  }
  import Inner = Z;
  export import Exported = Z;
  export enum Own {
    P = Inner.Q,
    R,
  }
  export enum ThroughExported {
    P = Exported.Q,
    R = 1,
  }
  export const read = () => [Inner.Q, Exported.Q];
}
namespace M {
  import Sibling = Z;
  export enum FromSibling {
    P = Sibling.Q,
    R,
  }
  export const readSibling = () => [Sibling.Q, Exported.Q];
}
const reads = () => [X.Q, X["Q"], X.Text, AZ.Q, N.Z.Q, W.Q, M.Exported.Q, X?.Q, Behind.Q];
function shadowed(X: { Q: unknown }) {
  return X.Q;
}
import Behind = Z;

console.log(
  "enums",
  JSON.stringify([
    FromAlias,
    B.FromNamespace,
    B.FromNamespaceAlias,
    B.FromAliasOfAlias,
    TopLevel,
    M.Own,
    M.ThroughExported,
    M.FromSibling,
  ]),
);
const readAll = () => JSON.stringify([reads(), M.read(), M.readSibling(), shadowed({ Q: "parameter" })]);
console.log("before", readAll());
for (const object of [Z, A.Z, M.Z]) change(object);
console.log("after", readAll());
