// A cycle of types is described as one component, in time that does not grow with the number of paths through it. The identity of a member does not depend on where the walk enters the cycle, and members that are alike have one identity.
type T0 = [T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13];
type T1 = [T0, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13];
type T2 = [T0, T1, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13];
type T3 = [T0, T1, T2, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13];
type T4 = [T0, T1, T2, T3, T5, T6, T7, T8, T9, T10, T11, T12, T13];
type T5 = [T0, T1, T2, T3, T4, T6, T7, T8, T9, T10, T11, T12, T13];
type T6 = [T0, T1, T2, T3, T4, T5, T7, T8, T9, T10, T11, T12, T13];
type T7 = [T0, T1, T2, T3, T4, T5, T6, T8, T9, T10, T11, T12, T13];
type T8 = [T0, T1, T2, T3, T4, T5, T6, T7, T9, T10, T11, T12, T13];
type T9 = [T0, T1, T2, T3, T4, T5, T6, T7, T8, T10, T11, T12, T13];
type T10 = [T0, T1, T2, T3, T4, T5, T6, T7, T8, T9, T11, T12, T13];
type T11 = [T0, T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T12, T13];
type T12 = [T0, T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T13];
type T13 = [T0, T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12];
type U0 = [U1, number];
type U1 = [U0, string];
interface Box<T> { value: T }
let top: T3;
let argument: Box<T3>;
let alike: T9;
let first: U0;
let second: U1;
export {};
