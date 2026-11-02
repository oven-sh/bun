// Plain Bun puts the value in place of `Kind.name` and `Kind["name"]`, but reads the object for a name in brackets that is not ASCII. The program sees which it was by changing the object, by deleting a member and by reading ahead of the declaration. A member computed from such a read is no constant either.
function change(object: object) {
  const record = object as Record<string, unknown>;
  for (const name of Object.keys(record)) record[name] = "changed";
}

function attempt(read: () => unknown) {
  try {
    return read();
  } catch (error) {
    return (error as Error).name;
  }
}

console.log("before the enum", attempt(() => Late["é"]), attempt(() => Late.é), attempt(() => Late["A"]));
enum Late { "é" = 1, A = 2 }
console.log("after the enum", Late["é"], Late.é, Late["A"]);
delete (Late as Record<string, unknown>)["é"];
delete (Late as Record<string, unknown>).A;
console.log("deleted", Late["é"], Late.é, Late["A"], Late.A);

enum Kind { Plain = 2, "é" = 1, "a-b" = 3 }
change(Kind);
console.log("Plain", Kind.Plain);
console.log("é", Kind["é"]);
console.log("a-b", Kind["a-b"]);

enum Quoted { "é" = 1, "A" = 3, "\x42" = 4, "è" = 5, "with space" = 6 }
change(Quoted);
console.log("brackets", Quoted["é"], Quoted["é"], Quoted[`é`], Quoted[("é")], Quoted!["é"]);
console.log("dot", Quoted.é, Quoted.é);
console.log("ascii", Quoted["A"], Quoted.A, Quoted["\x41"], Quoted[`A`], Quoted["with space"]);
console.log("ascii written with an escape", Quoted.B, Quoted["B"], Quoted["\x42"], Quoted["B"]);
console.log("declared with an escape", Quoted["è"], Quoted.è, Quoted["è"]);

enum Bare { é = 1, ñandú = 2, è = 3 }
change(Bare);
console.log("bare, brackets", Bare["é"], Bare["ñandú"], Bare["è"]);
console.log("bare, dot", Bare.é, Bare.ñandú, Bare.è);

enum Astral { "😀" = 1, 𝒳 = 2, "𝒴" = 3 }
change(Astral);
console.log("astral, brackets", Astral["😀"], Astral["𝒳"], Astral["𝒴"], Astral["\u{1F600}"], Astral["😀"]);
console.log("astral, dot", Astral.𝒳, Astral.𝒴);

enum Merged { "é" = 1 }
enum Merged { B = 2, "ü" = 3 }
change(Merged);
console.log("merged", Merged["é"], Merged.é, Merged.B, Merged["B"], Merged["ü"], Merged.ü);

namespace Outer {
  export enum Inner { "é" = 1, B = 2 }
  export namespace Deep {
    export enum Innermost { "é" = 1, B = 2 }
  }
}
change(Outer.Inner);
change(Outer.Deep.Innermost);
console.log("in a namespace", Outer.Inner["é"], Outer.Inner.é, Outer.Inner.B);
console.log("two namespaces deep", Outer.Deep.Innermost["é"], Outer.Deep.Innermost.é, Outer.Deep.Innermost["B"]);

enum Texts { "é" = "e", "ü" = "ü", U = "ü" }
change(Texts);
console.log("texts", Texts["é"], Texts.é, Texts["ü"], Texts.ü, Texts.U, Texts["U"]);

enum Derived {
  é = 1,
  FromName = é + 1,
  FromDot = Derived.é + 1,
  FromBrackets = Derived["é"] + 1,
  Next,
  FromAscii = Derived["FromName"] + 1,
}
console.log("derived", JSON.stringify(Derived));
change(Derived);
console.log("derived", Derived.FromName, Derived.FromDot, Derived.FromBrackets, Derived.Next, Derived.FromAscii);

const enum Constant { "é" = 1, A = 2, ñ = 3 }
// @ts-expect-error
change(Constant);
console.log("const enum", Constant["é"], Constant.é, Constant["A"], Constant.A, Constant["ñ"], Constant.ñ);

function choose(kind: Bare) {
  switch (kind) {
    case Bare["é"]:
      return "brackets";
    case Bare.ñandú:
      return "dot";
    default:
      return "neither";
  }
}
console.log("switch", choose(1), choose(2), choose("changed" as unknown as Bare));

function findPlace(run: () => unknown) {
  try {
    run();
    return "nothing thrown";
  } catch (error) {
    return (error as Error).stack!.split("\n")[1].replace(/^.*?(\d+:\d+)\)?$/, "$1");
  }
}
enum Level { "é" = 1, A = 2 }
console.log("a called member", findPlace(() => (Level["é"] as any)()), findPlace(() => (Level.é as any)()), findPlace(() => (Level["A"] as any)()));
console.log("a called sum", findPlace(() => ((Level["é"] + 1) as any)()), findPlace(() => ((Level["A"] + 1) as any)()));
