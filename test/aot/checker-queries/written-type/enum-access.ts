// An enum member access is a constant, unless the enum is imported or only declared, or its name is unbound at run time. A member of an imported `const` enum is a constant too.
/// <reference path="./enum-access.d.ts" />
import { F } from "./enum-access-other";
enum E {
  A = 1,
  B = "b",
}
E.A;
E["B"];
F.X;
G.Y;
declare enum H { Z = 4 }
declare const enum I { W = 5 }
declare namespace N { enum J { V = 6 } }
H.Z;
I.W;
N.J.V;
import "./enum-access-script";
S.T;
import { K } from "./enum-access-other";
import { K as L } from "./enum-access-again";
import * as all from "./enum-access-again";
K.X;
L["X"];
all.K.X;
all.F.X;
