interface I1 { x: number }
interface I1 { x: string }
var v: { a: number };
var v: { a: string };
declare let c1: { a: number }; declare let c2: { a: string };
if (c1 === c2) {}
const as1 = c1 as { b: number };
declare let s0: string;
switch (s0) { case 1: }
const as2 = 1 as string;
