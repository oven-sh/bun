interface Co<T> { get(): T }
interface Contra<T> { set: (v: T) => void }
interface Inv<T> { get(): T; set: (v: T) => void }
interface Indep<T> { x: number }
interface Bi<T> { m(v: T): void }
declare let co1: Co<string>; declare let co2: Co<"a">;
co1 = co2; co2 = co1;
declare let ct1: Contra<string>; declare let ct2: Contra<"a">;
ct1 = ct2; ct2 = ct1;
declare let in1: Inv<string>; declare let in2: Inv<"a">;
in1 = in2; in2 = in1;
declare let id1: Indep<string>; declare let id2: Indep<number>;
id1 = id2;
declare let bi1: Bi<string>; declare let bi2: Bi<"a">;
bi1 = bi2; bi2 = bi1;
type Un<T> = { [K in keyof T]-?: T[K] };
declare let u1: Un<{ a?: string }>; declare let u2: Un<{ a: number }>;
u1 = u2;
interface List<T> { head: T; tail: List<T> | null }
declare let l1: List<string>; declare let l2: List<number>;
l1 = l2;
type Box<T> = { v: T };
declare let b1: Box<string>; declare let b2: Box<number>;
b1 = b2;
