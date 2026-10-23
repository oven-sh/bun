// An enum member whose value rests on a power that is not exact is no constant of the build: its digits are those of the engine's arithmetic, so the program computes it.
import { Other } from "./enum-member-inexact-power-other";
function scope() {
  const inlined = 3 ** 100;
  {
    enum FromConstant { A = inlined }
    FromConstant.A;
  }
}
export enum E {
  Exact = 2 ** 10,
  AfterExact,
  Inexact = 3 ** 100,
  AfterInexact,
  FromSibling = Inexact % 1000,
  FromAccess = E.Inexact,
  InText = `${7 ** 30}`,
  FromText = `${InText}!`,
  Fraction = 2 ** 0.5,
  Negative = 10 ** -5,
  ZeroExponent = 7.5 ** 0,
  FromOtherFile = Other.Inexact,
  Plain = 1,
}
E.Exact;
E.AfterExact;
E.Inexact;
E.AfterInexact;
E.FromSibling;
E.FromAccess;
E.InText;
E.FromText;
E.ZeroExponent;
E.Plain;
