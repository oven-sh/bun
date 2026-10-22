// Code that a constant keeps from running reports no type errors: the body of a loop, a clause of a switch, an operand behind a condition that is decided though its value is not known, what follows `?.` on null.
declare const live: string;
while (false) { const a: number = "x"; }
for (; false; ) { const b: number = "x"; }
const kind: number = 1;
switch (kind) {
  case 0: { const c: number = "x"; break; }
  case 1: break;
  default: { const d: number = "x"; }
}
live && false && ((): number => "x")();
live && false ? ((): number => "x")() : 0;
const nothing = false ? { member: 1 } : null;
nothing?.member.missing;
const e: number = "y";
