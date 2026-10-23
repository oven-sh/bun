// An enum member is a constant where `bun run` inlines it: not where its value reads another file, a variable or a declared enum, not after such a member, and not through an import.
import { Other } from "./enum-member-origin-other";
const five = 5;
declare enum Declared { A = 1 }
enum Own { A = 2 }
export enum E {
  Shifted = 1 << 1,
  AfterShifted,
  FromOwnFile = Own.A,
  FromOtherFile = Other.A,
  AfterOtherFile,
  FromVariable = five,
  FromDeclared = Declared.A,
}
E.Shifted;
E.AfterShifted;
E.FromOwnFile;
E.FromOtherFile;
E.AfterOtherFile;
E.FromVariable;
E.FromDeclared;
import { E as Alias } from "./enum-member-origin";
Alias.Shifted;
