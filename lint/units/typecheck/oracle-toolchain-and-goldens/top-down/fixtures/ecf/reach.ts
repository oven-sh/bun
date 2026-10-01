declare function fail(): never;
declare function assert(x: boolean): asserts x;
function r1(x: "a" | "b") {
  switch (x) { case "a": return 1; case "b": return 2; }
  const dead1 = 1;
}
function r2() { return; var hoisted; const dead2 = 2; function stillFine() {} }
function r3() { fail(); const dead3 = 3; }
function r4() { assert(false); const dead4 = 4; }
function r5(n: number) { while (true) { if (n) break; } const live = 1; for (;;) {} const dead5 = 5; }
function r6() { throw 1; enum E { A } const enum CE { A } namespace N { export const v = 1; } namespace T { export type X = 1; } }
function r7(): number { if (Math.random()) return 1; }
function r8(x: boolean) { if (x) { return 1; } else { return 2; } x; x; }
l1: for (;;) { break l1; }
unused: { }
