// What a program evaluates is no TypeScript: it reads the members of an enum at run time.
import { Imported } from "./imported";
enum Kind { First = 1, Second = "second" }
namespace Names { export enum Inner { Third = 3 } }
const enum Constant { Fourth = 4 }
function read(): string {
  const functions: (() => unknown)[] = [eval("(function () { return Kind.First; })"), eval("(() => Kind['Second'])"), eval("(function () { return Names.Inner.Third; })"), eval("(() => Imported.Fifth)")];
  return functions.map((it) => String(it())).join();
}
console.log(read());
(Kind as any).First = "first stored";
(Kind as any).Second = "second stored";
(Names.Inner as any).Third = "third stored";
(Imported as any).Fifth = "fifth stored";
console.log(read(), Kind.First, Kind.Second, Names.Inner.Third, Constant.Fourth);
