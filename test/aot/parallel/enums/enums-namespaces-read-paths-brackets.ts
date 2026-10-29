// Enums in namespaces are read by paths in brackets after their objects change.
function attempt(read: () => unknown) {
  try {
    return read();
  } catch (error) {
    return (error as Error).name;
  }
}
function change(object: unknown) {
  const held = object as Record<string, unknown>;
  for (const name of Object.keys(held)) {
    if (typeof held[name] !== "object" && typeof held[name] !== "function") held[name] = "changed";
  }
}

console.log(
  "ahead of the namespace",
  attempt(() => Outer.Inner.A),
  attempt(() => Outer["Inner"].A),
  attempt(() => Outer["Inner"]["A"]),
);
namespace Outer {
  console.log(
    "ahead of the enum",
    attempt(() => Inner.A),
    attempt(() => Outer.Inner.A),
    attempt(() => Outer["Inner"].A),
  );
  export enum Inner {
    A = 1,
    Text = "text",
    "with-dash" = 3,
    Sum = A + 4,
  }
  export const enum Fixed {
    A = 10,
    Text = "fixed",
  }
  export namespace Middle {
    export enum Deep {
      A = 100,
      Text = "deep",
    }
    export namespace Lower {
      export enum Deepest {
        A = 1000,
      }
    }
  }
  export let count = 0;
}
change(Outer.Inner);
change(Outer.Middle.Deep);
change(Outer.Middle.Lower.Deepest);
change((Outer as Record<string, unknown>).Fixed);

console.log("dots", Outer.Inner.A, Outer.Inner.Text, Outer.Inner.Sum);
console.log("namespace link in brackets", Outer["Inner"].A, Outer["Inner"].Text, Outer["Inner"].Sum);
console.log("both in brackets", Outer["Inner"]["A"], Outer["Inner"]["Text"], Outer["Inner"]["with-dash"]);
console.log("member in brackets", Outer.Inner["A"], Outer.Inner["Text"], Outer.Inner["with-dash"]);
console.log("backticks", Outer[`Inner`].A, Outer[`Inner`][`A`], Outer.Inner[`A`]);
console.log("escapes", Outer["\x49nner"].A, Outer["Inner"]["\x41"]);
console.log("parenthesized keys", Outer[("Inner")].A, Outer["Inner"][("A")]);
console.log("parenthesized links", (Outer["Inner"]).A, (Outer.Inner).A, (Outer)["Inner"].A, (Outer).Inner.A);
console.log(
  "type assertions",
  Outer["Inner"]!.A,
  (Outer["Inner"] as typeof Outer.Inner).A,
  Outer!["Inner"].A,
  Outer!.Inner.A,
  (Outer as typeof Outer).Inner.A,
  (Outer satisfies object)["Inner"].A,
  (<typeof Outer>Outer).Inner.A,
);
console.log("const enum", Outer.Fixed.A, Outer["Fixed"].A, Outer["Fixed"]["A"], Outer["Fixed"].Text);
console.log("three names", Outer["Middle"].Deep.A, Outer.Middle["Deep"].A, Outer.Middle.Deep["A"]);
console.log("three names", Outer["Middle"]["Deep"].A, Outer["Middle"].Deep["A"], Outer["Middle"]["Deep"]["Text"]);
console.log(
  "four names",
  Outer["Middle"].Lower.Deepest.A,
  Outer.Middle["Lower"].Deepest.A,
  Outer.Middle.Lower["Deepest"].A,
  Outer["Middle"]["Lower"]["Deepest"]["A"],
);
console.log("optional links", Outer?.["Inner"].A, Outer["Inner"]?.A, Outer["Inner"]?.["A"], Outer?.Inner.A);
console.log("optional links in parentheses", (Outer?.Inner).A, (Outer?.["Inner"]).A, (Outer?.Inner)!.A);
const key = "Inner";
console.log("key in a constant", Outer[key].A, Outer[key]["A"]);
console.log("reverse", Outer["Inner"][1], Outer.Inner[1]);
console.log("typeof", typeof Outer["Inner"].A, typeof Outer["Inner"]["Text"]);
switch (1 as number) {
  case Outer["Inner"].A:
    console.log("switch takes the case");
    break;
  default:
    console.log("switch takes the default");
}
console.log("condition", Outer["Inner"].A === 1 ? "one" : "not one", Outer["Inner"].Text === "text" ? "text" : "other");
console.log("method of the value", Outer["Inner"].A.toFixed(1), Outer["Inner"]["A"]["toString"]());
console.log("template", `${Outer["Inner"].A}`, JSON.stringify({ [Outer["Inner"].A]: Outer["Inner"].Text }));
Outer["count"]++;
Outer["count"] += 2;
console.log("variable of the namespace", Outer["count"], Outer.count);

import EnumAlias = Outer.Inner;
import NamespaceAlias = Outer.Middle;
import OutermostAlias = Outer;
namespace Within {
  export import Again = Outer.Inner;
  export import Space = Outer.Middle;
  console.log("aliases inside", Again.A, Again["A"], Space.Deep.A, Space["Deep"].A);
}
console.log("alias of the enum", EnumAlias.A, EnumAlias["A"]);
console.log("alias of a namespace", NamespaceAlias.Deep.A, NamespaceAlias["Deep"].A, NamespaceAlias["Deep"]["A"]);
console.log("alias of the outermost", OutermostAlias.Inner.A, OutermostAlias["Inner"].A, OutermostAlias["Middle"]["Deep"].A);
console.log("exported aliases", Within.Again.A, Within["Again"].A, Within.Space.Deep.A, Within["Space"]["Deep"].A);
const heldNamespace = Outer;
const heldEnum = Outer["Inner"];
console.log("constants that hold them", heldNamespace.Inner.A, heldNamespace["Inner"].A, heldEnum.A, heldEnum["A"]);

enum Both {
  A = 1,
}
namespace Both {
  export const extra = "extra";
  export enum Nested {
    A = 5,
  }
  export function read() {
    return [Both.A, Both["A"], Nested.A, Nested["A"], Both.Nested.A, Both["Nested"].A, Both["Nested"]["A"]];
  }
}
namespace Parts {
  export enum First {
    A = 1,
  }
  export enum Once {
    A = 3,
  }
  export namespace Below {
    export enum Two {
      A = 2,
    }
  }
}
namespace Parts {
  export enum First {
    B = 7,
  }
  export enum Second {
    FromName = First.A + 10,
    FromPath = Parts.First.A + 20,
    FromOtherPart = Once.A + 30,
    FromOtherPartInBrackets = Once["A"] + 40,
    FromBelow = Below.Two.A + 50,
  }
  export function read() {
    return [First.A, First["A"], First.B, Parts.First.A, Parts["First"].A, Parts["First"].B];
  }
  export function readOtherPart() {
    return [Once.A, Once["A"], Parts.Once.A, Parts["Once"].A, Below.Two.A, Below["Two"].A, Parts["Below"]["Two"].A];
  }
}
namespace Holder {
  export enum Twice {
    A = 11,
  }
  export enum Twice {
    B = 12,
  }
}
class Shape {}
namespace Shape {
  export enum Kind {
    Round = 1,
  }
}
function make() {}
namespace make {
  export enum Kind {
    Square = 2,
  }
}
console.log("values", JSON.stringify(Parts.Second));
change(Both);
change(Both.Nested);
change(Parts.First);
change(Parts.Once);
change(Parts.Below.Two);
change(Parts.Second);
change(Holder.Twice);
change(Shape.Kind);
change(make.Kind);
console.log("enum and namespace", Both.A, Both["A"], Both.extra, Both["extra"]);
console.log("enum in that namespace", Both.Nested.A, Both["Nested"].A, Both["Nested"]["A"], ...Both.read());
console.log("namespace in two parts", Parts["First"].A, Parts["First"]["A"], Parts["First"].B, ...Parts.read());
console.log("names of the other part", ...Parts.readOtherPart());
console.log("initializers", Parts.Second.FromName, Parts["Second"].FromName, Parts["Second"]["FromPath"]);
console.log(
  "initializers on the other part",
  Parts.Second.FromOtherPart,
  Parts.Second.FromOtherPartInBrackets,
  Parts["Second"].FromBelow,
);
console.log("enum in two parts", Holder.Twice.A, Holder["Twice"].A, Holder["Twice"].B, Holder["Twice"]["B"]);
console.log("class and namespace", Shape.Kind.Round, Shape["Kind"].Round, Shape["Kind"]["Round"]);
console.log("function and namespace", make.Kind.Square, make["Kind"].Square, make["Kind"]["Square"]);

const loose = Outer as unknown as { Inner: Record<string, unknown> };
(Outer["Inner"] as Record<string, unknown>).A = "stored";
console.log("stored", Outer["Inner"].A, loose.Inner.A);
console.log("deleted", delete (Outer["Inner"] as Record<string, unknown>).A, Outer["Inner"].A, loose.Inner.A);
console.log("in", "A" in Outer["Inner"], "Text" in Outer["Inner"]);
delete (Outer as Record<string, unknown>).Inner;
console.log(
  "enum deleted",
  attempt(() => Outer.Inner.A),
  attempt(() => Outer["Inner"].A),
  attempt(() => Outer["Inner"]["A"]),
  attempt(() => Outer["Inner"][1]),
);
