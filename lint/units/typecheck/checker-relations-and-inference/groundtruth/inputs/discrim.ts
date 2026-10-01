type S = { kind: "a"; a: number } | { kind: "b"; b: string } | { kind: "c"; c: boolean };
const s1: S = { kind: "a", a: "x" };
const s2: S = { kind: "d" };
declare let o: { kind: "a" | "b"; a: number; b: string };
declare let t: { kind: "a"; a: number; b: string } | { kind: "b"; a: number; b: string };
t = o;
type Big = { k: 0; v0: 0 } | { k: 1; v1: 1 } | { k: 2; v2: 2 } | { k: 3; v3: 3 } | { k: 4; v4: 4 } | { k: 5; v5: 5 }
  | { k: 6; v6: 6 } | { k: 7; v7: 7 } | { k: 8; v8: 8 } | { k: 9; v9: 9 } | { k: 10; v10: 10 } | { k: 11; v11: 11 };
const b1: Big = { k: 3, v3: "x" };
declare let bsrc: { k: 3; v3: 4 };
const b2: Big = bsrc;
declare let u3: string | number | boolean;
const u4: string | number = u3;
const u5: "a" | "b" | "c" = "d";
