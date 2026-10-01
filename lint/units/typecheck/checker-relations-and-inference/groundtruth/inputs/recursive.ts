interface R1 { next: R1; v: string }
interface R2 { next: R2; v: string }
interface R3 { next: R3; v: number }
declare let r1: R1; declare let r2: R2; declare let r3: R3;
r1 = r2;
r1 = r3;
type Deep<T> = { next: Deep<Deep<T>>; v: T };
type Loop<U> = { next: Loop<U>; v: unknown };
declare let d: Deep<string>; declare let l: Loop<string>;
l = d;
interface G1<T> { self: G1<G1<T>>; v: T }
interface G2<T> { self: G2<G2<T>>; v: T }
declare let g1: G1<string>; declare let g2: G2<string>;
g1 = g2;
