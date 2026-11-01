// An enum set from an enum inside a namespace beside it is read from its object.
const change = (held: unknown) => {
  const object = held as Record<string, unknown>;
  for (const name of Object.keys(object)) if (typeof object[name] !== "string" || !/^\d/.test(name)) object[name] = "changed";
};
namespace Outer {
  export enum Inner { A = 1 }
  export namespace Middle { export enum Deep { A = 100 } }
}
enum Above { A = 7 }
enum Rests {
  OnNamespaceAbove = Outer.Inner.A + 1,
  OnDeepAbove = Outer.Middle.Deep.A + 1,
  OnEnumAbove = Above.A + 1,
  OnOwn = OnEnumAbove + 1,
  OnOwnByName = Rests.OnEnumAbove + 2,
}
namespace Second {
  export enum FromTop { OnEnumAbove = Above.A + 10, OnSibling = Outer.Inner.A + 10 }
  export namespace Nested { export enum Low { A = 1000 } }
  export enum FromNested { OnNested = Nested.Low.A + 1, OnNestedByPath = Second.Nested.Low.A + 2 }
  export namespace Further { export enum FromUncle { OnUncle = Nested.Low.A + 3, OnFromTop = FromTop.OnEnumAbove + 3 } }
}
enum Below { A = 70 }
function local() {
  enum InFunction { OnNamespace = Outer.Inner.A + 20, OnEnum = Above.A + 20 }
  {
    enum InBlock { OnOuterBlock = InFunction.OnEnum + 1 }
    change(InBlock);
    console.log("in a block", InBlock.OnOuterBlock);
  }
  enum Later { A = 500 }
  change(InFunction);
  console.log("in a function", InFunction.OnNamespace, InFunction.OnEnum);
}
console.log(JSON.stringify([Rests, Second.FromTop, Second.FromNested, Second.Further.FromUncle]));
for (const held of [Rests, Second.FromTop, Second.FromNested, Second.Further.FromUncle]) change(held);
console.log("top", Rests.OnNamespaceAbove, Rests.OnDeepAbove, Rests.OnEnumAbove, Rests.OnOwn, Rests.OnOwnByName);
console.log("from top", Second.FromTop.OnEnumAbove, Second.FromTop.OnSibling);
console.log("from nested", Second.FromNested.OnNested, Second.FromNested.OnNestedByPath);
console.log("from uncle", Second.Further.FromUncle.OnUncle, Second.Further.FromUncle.OnFromTop);
local();
namespace Texts { export enum Inner { S = "s" } }
enum TextAbove { S = "t" }
enum RestsOnTexts { OnNamespace = Texts.Inner.S, OnEnum = TextAbove.S, OnJoined = Texts.Inner.S + "!", OnTemplate = `${Texts.Inner.S}?` }
console.log(JSON.stringify(RestsOnTexts));
function early() { return [Below.A, Last.Inner.A]; }
console.log(early);
namespace Last { export enum Inner { A = 3 } }
change(Below); change(Last.Inner);
console.log(early(), Below.A, Last.Inner.A);
namespace Stored { export enum Inner { A = 1 } }
enum StoredAbove { A = 7 }
(Stored.Inner as unknown as Record<string, unknown>).A = 50;
(StoredAbove as unknown as Record<string, unknown>).A = 60;
enum ReadsStored { OnNamespace = Stored.Inner.A + 1, OnEnum = StoredAbove.A + 1 }
namespace Third {
  export namespace Nested { export enum Low { A = 1000 } }
  (Nested.Low as unknown as Record<string, unknown>).A = 2000;
  export enum FromNested { OnNested = Nested.Low.A + 1 }
  export namespace Further { export enum FromUncle { OnUncle = Nested.Low.A + 3 } }
}
console.log(ReadsStored.OnNamespace, ReadsStored.OnEnum, Third.FromNested.OnNested, Third.Further.FromUncle.OnUncle);
console.log(JSON.stringify([ReadsStored, Third.FromNested, Third.Further.FromUncle]));
